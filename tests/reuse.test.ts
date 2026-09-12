import { describe, it, expect } from 'vitest';
import { canReuse, type ReusableFields } from '../src/pipeline/reuse';

/**
 * The gate that decides whether an ingest pays for an LLM summary and an
 * embedding. A wrong `false` costs money; a wrong `true` serves a stale summary
 * forever, so every field is checked here rather than just the version.
 */
describe('canReuse', () => {
  const PROVIDER = 'openai:text-embedding-3-small';
  const full = (over: Partial<ReusableFields> = {}): ReusableFields => ({
    latestVersion: '1.2.3',
    summary: 'A thing that does a thing.',
    usageGuide: { whatItIs: 'x', whenToUse: 'y', whereItFits: 'z' } as ReusableFields['usageGuide'],
    embedding: [0.1, 0.2],
    embeddingProvider: PROVIDER,
    ...over,
  });

  it('reuses a complete row still at the published latest version', () => {
    expect(canReuse(full(), '1.2.3', PROVIDER)).toBe(true);
  });

  it('regenerates when the package published a new version', () => {
    expect(canReuse(full(), '1.3.0', PROVIDER)).toBe(false);
  });

  it('regenerates when the embedding model changed', () => {
    expect(canReuse(full(), '1.2.3', 'openai:text-embedding-3-large')).toBe(false);
  });

  // Each of these is a row that is at the right version but incomplete. Reusing
  // one would make the missing field permanent, which is the failure mode worth
  // paying to avoid.
  it.each([
    ['summary', { summary: null }],
    ['usage guide', { usageGuide: null }],
    ['embedding', { embedding: null }],
    ['embedding provider', { embeddingProvider: null }],
  ])('regenerates when the stored row has no %s', (_label, gap) => {
    expect(canReuse(full(gap as Partial<ReusableFields>), '1.2.3', PROVIDER)).toBe(false);
  });

  it('regenerates for a package not in the index yet', () => {
    expect(canReuse(null, '1.2.3', PROVIDER)).toBe(false);
    expect(canReuse(undefined, '1.2.3', PROVIDER)).toBe(false);
  });

  // npm reported no latest version, so there is nothing to compare against and
  // no basis for calling the stored copy current.
  it('regenerates when the registry gave no latest version', () => {
    expect(canReuse(full(), null, PROVIDER)).toBe(false);
  });

  // The null-vs-null trap: a row with no stored version must not match a package
  // with no reported version.
  it('does not match a versionless row against a versionless fetch', () => {
    expect(canReuse(full({ latestVersion: null }), null, PROVIDER)).toBe(false);
  });
});
