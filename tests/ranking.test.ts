import { describe, it, expect } from 'vitest';
import { rankScore } from '../src/search/recommend';
import { computeConfidence } from '../src/scoring/score';
import type { ScoringInput } from '../src/scoring/score';
import { COMPOSITE } from '../src/scoring/weights';

/**
 * Ranking regressions are invisible without numbers, so these use rows captured
 * from the LIVE index on the day the bug was found rather than invented ones.
 *
 * The bug: `confidence` was computed, stored, rendered and offered as a filter,
 * and had no effect at all on the default order. On a large index, hundreds of
 * packages match a need on text alone, so the slot went to whichever had the
 * keyword-densest description. "an orm for postgres" returned @bungres/orm
 * (275 weekly downloads), orchid-orm, turbine-orm, @podgres/pg (17/wk) and
 * zapatos — while Prisma, indexed at health 86, did not make the top five.
 */
const λ = COMPOSITE.lambda;

// Real rows, live index, 2026-08-10.
const PRISMA = { healthScore: 86, qualityScore: 77, confidence: 'proven' as const };
const BUNGRES = { healthScore: 66, qualityScore: 100, confidence: 'unproven' as const };
const DRIZZLE = { healthScore: 82, qualityScore: 83, confidence: 'proven' as const };
const ICONS = { healthScore: 40, qualityScore: 90, confidence: 'unproven' as const };

describe('rankScore — evidence has to count for something', () => {
  it('lets a proven package beat a toy that matches the text better', () => {
    // The toy is the single best textual match (relevance 1.0); prisma is a
    // middling one. This is exactly the losing configuration from the live run.
    const toy = rankScore(BUNGRES, 1.0, λ);
    const real = rankScore(PRISMA, 0.7, λ);
    expect(real).toBeGreaterThan(toy);
  });

  it('still loses to the toy under the OLD two-term formula (regression proof)', () => {
    // 0.6·relevance + 0.4·composite, the formula this replaced. Kept so the
    // test fails loudly if someone reinstates it.
    const old = (r: { healthScore: number; qualityScore: number }, rel: number) =>
      0.6 * rel + 0.4 * (((1 - λ) * r.healthScore + λ * r.qualityScore) / 100);
    expect(old(BUNGRES, 1.0)).toBeGreaterThan(old(PRISMA, 0.7));
  });

  it('does not let evidence alone win — relevance still leads', () => {
    // A proven package that barely matches the need must not displace a decent
    // match. Otherwise every query returns the same five popular packages.
    const irrelevantButProven = rankScore(PRISMA, 0.05, λ);
    const relevantNewcomer = rankScore(
      { healthScore: 70, qualityScore: 85, confidence: 'promising' },
      1.0,
      λ,
    );
    expect(relevantNewcomer).toBeGreaterThan(irrelevantButProven);
  });

  it('ranks two proven packages by fit, not by score alone', () => {
    expect(rankScore(DRIZZLE, 1.0, λ)).toBeGreaterThan(rankScore(PRISMA, 0.6, λ));
  });

  it('buries a keyword-dense satellite with no adoption', () => {
    // @ui-construction-library/icons: 23 weekly downloads, quality 90 because a
    // small generated package passes every hygiene check. Quality alone must
    // not buy a slot.
    expect(rankScore(PRISMA, 0.8, λ)).toBeGreaterThan(rankScore(ICONS, 1.0, λ));
  });
});

/**
 * The other half: those packages were labelled `emerging` in the first place
 * because growth qualified with no absolute floor, and a percentage on a tiny
 * base is noise. 4 → 17 weekly downloads is +325%.
 */
const input = (over: Partial<ScoringInput>): ScoringInput =>
  ({
    weeklyDownloads: 0,
    downloadGrowth90d: null,
    firstPublishedAt: new Date('2026-05-01'),
    lastReleaseAt: new Date('2026-08-01'),
    advisories: [],
    deprecated: false,
    archived: false,
    stars: null,
    ...over,
  }) as unknown as ScoringInput;

const NOW = new Date('2026-08-10');

describe('computeConfidence — growth needs a base to be growth', () => {
  it('refuses emerging for a 17/wk package with explosive relative growth', () => {
    expect(computeConfidence(input({ weeklyDownloads: 17, downloadGrowth90d: 3.25 }), NOW, 40)).toBe(
      'unproven',
    );
  });

  it('refuses emerging at 275/wk, the case that outranked Prisma', () => {
    expect(computeConfidence(input({ weeklyDownloads: 275, downloadGrowth90d: 1.75 }), NOW, 40)).toBe(
      'unproven',
    );
  });

  it('still grants emerging to real growth above the floor', () => {
    expect(
      computeConfidence(input({ weeklyDownloads: 2_000, downloadGrowth90d: 0.8 }), NOW, 40),
    ).toBe('emerging');
  });

  it('still grants emerging on volume alone, with no growth at all', () => {
    expect(computeConfidence(input({ weeklyDownloads: 8_000, downloadGrowth90d: 0 }), NOW, 40)).toBe(
      'emerging',
    );
  });

  it('leaves the adoption-independent promising tier intact', () => {
    // A tiny package can still surface on intrinsic quality — that tier is the
    // point of the two-axis model and this change must not close it.
    expect(computeConfidence(input({ weeklyDownloads: 17 }), NOW, 85)).toBe('promising');
  });
});

/**
 * The ladder was wrong in both directions, and the second was worse.
 *
 * Because the stored label is frozen at ingest, nothing surfaced this until
 * confidence was re-derived: a mature package that simply had not needed a
 * release fell off a recency cliff. Real rows from the index — p-limit at 273M
 * weekly downloads and ten years old, demoted for a 6.2-month-old release.
 */
describe('computeConfidence — stability is not decay', () => {
  const mature = (monthsSinceRelease: number, dl: number) =>
    input({
      weeklyDownloads: dl,
      firstPublishedAt: new Date('2016-01-01'),
      lastReleaseAt: new Date(NOW.getTime() - monthsSinceRelease * 30.44 * 86_400_000),
    });

  it('keeps p-limit proven at 273M/wk with a 6.2-month-old release', () => {
    expect(computeConfidence(mature(6.2, 273_294_225), NOW, 60)).toBe('proven');
  });

  it('keeps @testing-library/react proven at 44M/wk and 6.7 months', () => {
    expect(computeConfidence(mature(6.7, 44_096_135), NOW, 60)).toBe('proven');
  });

  it('keeps @emotion/react proven at 14.7M/wk and 9.2 months', () => {
    expect(computeConfidence(mature(9.2, 14_683_732), NOW, 60)).toBe('proven');
  });

  it('still demotes a genuinely abandoned package', () => {
    // Past the ceiling, with nothing else vouching for it.
    expect(computeConfidence(mature(30, 273_294_225), NOW, 40)).toBe('unproven');
  });

  it('still refuses proven to anything deprecated, however popular', () => {
    const dead = { ...mature(1, 273_294_225), deprecated: true } as never;
    expect(computeConfidence(dead, NOW, 60)).not.toBe('proven');
  });
});
