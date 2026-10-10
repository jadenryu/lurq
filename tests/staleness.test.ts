import { describe, expect, it } from 'vitest';
import { versionAtDate } from '../src/surface/staleness';
import { MODEL_CUTOFFS, cutoffTableIsStale, resolveSince } from '../src/fix/modelCutoffs';

const v = (version: string, published: string | null) => ({
  version,
  publishedAt: published ? new Date(published) : null,
});

describe('versionAtDate', () => {
  it('picks what was current at the cutoff, not what exists now', () => {
    const versions = [v('7.0.0', '2026-03-01'), v('6.4.0', '2025-11-01'), v('6.0.0', '2025-02-01')];
    expect(versionAtDate(versions, '2026-01-01')).toBe('6.4.0');
  });

  it('takes the highest semver, not the most recently published', () => {
    // The real trap: a patch to an old major lands AFTER the new major shipped.
    // Ordering by publish date would claim the model learned 6.4.1 — an API
    // that was already superseded when it trained.
    const versions = [
      v('6.4.1', '2026-05-01'), // backport, published last
      v('7.0.0', '2026-03-01'),
      v('6.4.0', '2025-11-01'),
    ];
    expect(versionAtDate(versions, '2026-06-01')).toBe('7.0.0');
  });

  it('ignores prereleases', () => {
    // Model knowledge comes from docs and code written against stable releases.
    const versions = [v('8.0.0-beta.1', '2026-01-02'), v('7.2.0', '2026-01-01')];
    expect(versionAtDate(versions, '2026-02-01')).toBe('7.2.0');
  });

  it('returns null when nothing was published by the cutoff', () => {
    // The package did not exist yet, so the model believes nothing about it.
    // Reporting a finding here would be inventing one.
    expect(versionAtDate([v('1.0.0', '2026-08-01')], '2026-01-01')).toBeNull();
  });

  it('ignores versions with no recorded publish date', () => {
    expect(versionAtDate([v('9.9.9', null), v('1.0.0', '2025-01-01')], '2026-01-01')).toBe('1.0.0');
  });
});

describe('resolveSince', () => {
  it('resolves a known model to its published reliable-knowledge cutoff', () => {
    const got = resolveSince({ model: 'claude-sonnet-5' });
    expect(got).toEqual({
      date: '2026-01-01',
      basis: "claude-sonnet-5's reliable knowledge cutoff (2026-01)",
    });
  });

  it('uses the reliable-knowledge date, never the training-data date', () => {
    // Haiku 4.5 is the row where they differ (Feb 2025 vs Jul 2025). Using the
    // broader training date would under-report: symbols removed between
    // February and July would be dropped from a report whose whole claim is
    // that it lists what the model gets wrong.
    const haiku = MODEL_CUTOFFS.get('claude-haiku-4-5')!;
    expect(haiku.reliableKnowledge).not.toBe(haiku.trainingData);
    expect(resolveSince({ model: 'claude-haiku-4-5' })).toMatchObject({ date: '2025-02-01' });
  });

  it('prefers an explicit --since over the shipped table', () => {
    // The caller stating a fact about their own setup outranks a table baked
    // into a release.
    expect(resolveSince({ model: 'claude-sonnet-5', since: '2024-06' })).toMatchObject({
      date: '2024-06-01',
    });
  });

  it('resolves a bare month to its first day', () => {
    // Erring early makes the number a floor: every symbol reported is one the
    // model really is behind on.
    expect(resolveSince({ since: '2026-03' })).toMatchObject({ date: '2026-03-01' });
  });

  it('refuses an unknown model instead of guessing a date', () => {
    const got = resolveSince({ model: 'some-other-llm' });
    expect(got).toHaveProperty('error');
    expect((got as { error: string }).error).toContain('--since');
  });

  it('refuses a malformed date', () => {
    expect(resolveSince({ since: 'last year' })).toHaveProperty('error');
  });

  it('requires one of the two inputs', () => {
    expect(resolveSince({})).toHaveProperty('error');
  });
});

describe('cutoff table freshness', () => {
  it('is not stale as shipped', () => {
    expect(cutoffTableIsStale(new Date('2026-09-22'))).toBe(false);
  });

  it('goes stale so an old release stops answering for models it cannot know', () => {
    expect(cutoffTableIsStale(new Date('2027-09-22'))).toBe(true);
  });
});
