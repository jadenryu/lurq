import { describe, it, expect } from 'vitest';
import {
  computeMaintenance,
  computeAdoption,
  computeReliability,
  computeEfficiency,
  computeHealthScore,
  computeQuality,
  computeComposite,
  computeConfidence,
  isRecognizedLicense,
  median,
  type ScoringInput,
} from '../src/scoring';
import type { Advisory } from '../src/core/types';

const NOW = new Date('2026-06-20T00:00:00Z');
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 86400000);
const monthsAgo = (n: number) => new Date(NOW.getTime() - n * 30 * 86400000);

function base(overrides: Partial<ScoringInput> = {}): ScoringInput {
  return {
    weeklyDownloads: 1000,
    downloadGrowth90d: 0,
    stars: null,
    dependentsCount: null,
    firstPublishedAt: monthsAgo(24),
    lastReleaseAt: daysAgo(20),
    releasesLast12mo: 6,
    openIssues: 20,
    closedIssues: 180,
    scorecard: 7,
    advisories: [],
    deprecated: false,
    archived: false,
    bundleMinGzipKb: null,
    category: 'orm',
    hasTypes: true,
    hasTestScript: true,
    readmeLength: 2000,
    hasExamples: true,
    hasHomepage: true,
    hasReleaseNotes: true,
    directDependenciesCount: 2,
    license: 'MIT',
    hasProvenance: false,
    ...overrides,
  };
}

describe('maintenance', () => {
  it('caps deprecated/archived packages at 15', () => {
    expect(computeMaintenance(base({ deprecated: true }), NOW)).toBe(15);
    expect(computeMaintenance(base({ archived: true }), NOW)).toBe(15);
  });

  it('rewards a fresh, well-maintained package', () => {
    const fresh = computeMaintenance(
      base({ lastReleaseAt: daysAgo(10), releasesLast12mo: 12, openIssues: 20, closedIssues: 180 }),
      NOW,
    );
    expect(fresh).toBeGreaterThan(90);
  });

  it('penalizes a long-stale, unmaintained package', () => {
    const stale = computeMaintenance(
      base({
        lastReleaseAt: daysAgo(700),
        releasesLast12mo: 0,
        openIssues: 180,
        closedIssues: 20,
      }),
      NOW,
    );
    expect(stale).toBeLessThan(15);
  });
});

describe('adoption', () => {
  it('scales with downloads (log)', () => {
    expect(computeAdoption(base({ weeklyDownloads: 10 }))).toBeLessThan(10);
    expect(computeAdoption(base({ weeklyDownloads: 10_000_000 }))).toBe(100);
  });

  it('applies a growth bonus/penalty', () => {
    const flat = computeAdoption(base({ weeklyDownloads: 100_000, downloadGrowth90d: 0 }));
    const rising = computeAdoption(base({ weeklyDownloads: 100_000, downloadGrowth90d: 0.5 }));
    const falling = computeAdoption(base({ weeklyDownloads: 100_000, downloadGrowth90d: -0.5 }));
    expect(rising).toBeGreaterThan(flat);
    expect(falling).toBeLessThan(flat);
  });
});

describe('reliability', () => {
  it('maps scorecard 0-10 to 0-100', () => {
    expect(computeReliability(base({ scorecard: 8, advisories: [] }))).toBe(80);
  });

  it('subtracts advisory penalties by severity and floors at 0', () => {
    const advs: Advisory[] = [
      { id: 'a', severity: 'critical', summary: '' },
      { id: 'b', severity: 'high', summary: '' },
    ];
    // 80 - 40 - 20 = 20
    expect(computeReliability(base({ scorecard: 8, advisories: advs }))).toBe(20);
    const many: Advisory[] = Array.from({ length: 5 }, (_, i) => ({
      id: `c${i}`,
      severity: 'critical',
      summary: '',
    }));
    expect(computeReliability(base({ scorecard: 5, advisories: many }))).toBe(0);
  });

  it('uses a neutral value when scorecard is unknown', () => {
    expect(computeReliability(base({ scorecard: null, advisories: [] }))).toBe(50);
  });
});

describe('efficiency', () => {
  it('rewards smaller-than-median frontend bundles', () => {
    expect(computeEfficiency(30, 'styling', 60)).toBe(75); // 100 - 0.5*50
    expect(computeEfficiency(120, 'styling', 60)).toBe(0); // 100 - 2*50
  });

  it('returns null for backend categories or missing data', () => {
    expect(computeEfficiency(30, 'orm', 60)).toBeNull();
    expect(computeEfficiency(null, 'styling', 60)).toBeNull();
    expect(computeEfficiency(30, 'styling', null)).toBeNull();
  });
});

describe('composite health score', () => {
  it('uses all four weights when efficiency is present', () => {
    expect(
      computeHealthScore({ maintenance: 80, adoption: 60, reliability: 40, efficiency: 50, quality: 90 }),
    ).toBe(61); // 28 + 18 + 10 + 5 — quality is NOT part of health
  });

  it('redistributes efficiency weight when null', () => {
    // (0.35*80 + 0.30*60 + 0.25*40) / 0.90 = 56 / 0.9 = 62.2
    expect(
      computeHealthScore({ maintenance: 80, adoption: 60, reliability: 40, efficiency: null, quality: 10 }),
    ).toBe(62); // quality does not affect health either way
  });
});

describe('quality (intrinsic, adoption-independent §1)', () => {
  it('rewards a well-built package (types, tests, docs, lean deps, OSI license)', () => {
    const q = computeQuality(base());
    expect(q).not.toBeNull();
    expect(q!).toBeGreaterThan(80);
  });

  it('penalizes a poorly-built package (no types/tests, thin docs, many deps)', () => {
    const q = computeQuality(
      base({
        hasTypes: false,
        hasTestScript: false,
        readmeLength: 50,
        hasExamples: false,
        hasHomepage: false,
        hasReleaseNotes: false,
        directDependenciesCount: 40,
        license: null,
      }),
    );
    expect(q!).toBeLessThan(25);
  });

  it('does not depend on adoption — downloads/stars never enter quality', () => {
    const popular = computeQuality(base({ weeklyDownloads: 10_000_000, stars: 90_000 }));
    const obscure = computeQuality(base({ weeklyDownloads: 5, stars: 0 }));
    expect(popular).toBe(obscure);
  });

  it('drops missing components rather than zeroing them', () => {
    // Only license known: score is that single component, not dragged by absent ones.
    const q = computeQuality(
      base({
        hasTypes: null,
        hasTestScript: null,
        readmeLength: null,
        hasExamples: null,
        hasHomepage: null,
        hasReleaseNotes: null,
        directDependenciesCount: null,
        license: 'MIT',
        hasProvenance: null,
      }),
    );
    expect(q).toBe(100);
  });

  it('returns null when no signal is available at all', () => {
    expect(
      computeQuality(
        base({
          hasTypes: null,
          hasTestScript: null,
          readmeLength: null,
          hasExamples: null,
          hasHomepage: null,
          hasReleaseNotes: null,
          directDependenciesCount: null,
          license: null,
          hasProvenance: null,
        }),
      ),
    ).toBeNull();
  });

  it('recognizes common OSI licenses', () => {
    expect(isRecognizedLicense('MIT')).toBe(true);
    expect(isRecognizedLicense('Apache-2.0')).toBe(true);
    expect(isRecognizedLicense('SEE LICENSE IN LICENSE')).toBe(false);
    expect(isRecognizedLicense(null)).toBe(false);
  });
});

describe('composite (health ↔ quality blend §1)', () => {
  it('blends health and quality by lambda', () => {
    // (1-0.35)*80 + 0.35*40 = 52 + 14 = 66
    expect(computeComposite(80, 40, 0.35)).toBe(66);
  });

  it('falls back to pure health when quality is unavailable', () => {
    expect(computeComposite(80, null, 0.35)).toBe(80);
  });

  it('lets a high-quality package outrank a higher-health one as lambda rises', () => {
    const popularLowQuality = computeComposite(90, 30, 0.6);
    const nicheHighQuality = computeComposite(60, 95, 0.6);
    expect(nicheHighQuality).toBeGreaterThan(popularLowQuality);
  });
});

describe('confidence', () => {
  it('labels an established package `proven`', () => {
    const input = base({
      weeklyDownloads: 500_000,
      firstPublishedAt: monthsAgo(36),
      lastReleaseAt: monthsAgo(1),
      advisories: [],
    });
    expect(computeConfidence(input, NOW)).toBe('proven');
  });

  it('downgrades from proven when a high advisory exists', () => {
    const input = base({
      weeklyDownloads: 500_000,
      firstPublishedAt: monthsAgo(36),
      lastReleaseAt: monthsAgo(1),
      advisories: [{ id: 'x', severity: 'high', summary: '' }],
    });
    expect(computeConfidence(input, NOW)).not.toBe('proven');
  });

  it('labels a young-but-growing package `emerging`', () => {
    const input = base({
      weeklyDownloads: 8_000,
      firstPublishedAt: monthsAgo(4),
      lastReleaseAt: monthsAgo(2),
    });
    expect(computeConfidence(input, NOW)).toBe('emerging');
  });

  it('labels low-adoption or unmaintained packages `unproven`', () => {
    expect(
      computeConfidence(base({ weeklyDownloads: 100, lastReleaseAt: monthsAgo(20) }), NOW),
    ).toBe('unproven');
    expect(computeConfidence(base({ deprecated: true }), NOW)).toBe('unproven');
  });

  it('labels a new-but-high-quality, low-adoption package `promising` (§1)', () => {
    // Too few downloads for emerging, too young for proven — but high quality.
    const input = base({
      weeklyDownloads: 200,
      downloadGrowth90d: 0,
      firstPublishedAt: monthsAgo(2),
      lastReleaseAt: monthsAgo(1),
    });
    expect(computeConfidence(input, NOW)).toBe('unproven'); // no quality passed
    expect(computeConfidence(input, NOW, 85)).toBe('promising'); // high quality lifts it
  });

  it('does not award `promising` to a low-quality package', () => {
    const input = base({
      weeklyDownloads: 200,
      firstPublishedAt: monthsAgo(2),
      lastReleaseAt: monthsAgo(1),
    });
    expect(computeConfidence(input, NOW, 40)).toBe('unproven');
  });
});

describe('median', () => {
  it('handles odd/even/empty', () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([1, 2, 3, 4])).toBe(2.5);
    expect(median([])).toBeNull();
  });
});
