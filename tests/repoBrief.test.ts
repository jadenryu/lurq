import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { DepDrift, RepoDrift } from '../src/github/types';

const handleDiffSurface = vi.fn();
vi.mock('../src/mcp/surfaceHandlers', () => ({ handleDiffSurface }));

// briefRepo reads each package's release timeline to plan migration hops. The
// DB is out of scope here, so stub that one seam and keep the rest of the module.
const loadVersions = vi.fn(async () => new Map<string, string[]>());
vi.mock('../src/github/drift', async (importActual) => ({
  ...(await importActual<typeof import('../src/github/drift')>()),
  loadVersions: (...args: unknown[]) => loadVersions(...(args as [])),
}));

const { briefRepo, BRIEF_CAP } = await import('../src/github/brief');

const db = {} as never;

function dep(over: Partial<DepDrift> = {}): DepDrift {
  return {
    name: 'pkg',
    range: '^1.0.0',
    declaredIn: [{ path: 'package.json', range: '^1.0.0' }],
    resolved: '1.0.0',
    latest: '2.0.0',
    majorsBehind: 1,
    deprecated: false,
    advisories: 0,
    ...over,
  };
}

function drift(deps: DepDrift[]): RepoDrift {
  return {
    depsDeclared: deps.length,
    depsTracked: deps.length,
    majorDrift: 0,
    anyDrift: 0,
    deprecated: 0,
    advisories: 0,
    deps,
  };
}

const diff = (over: Record<string, unknown> = {}) => ({
  removed: [],
  added: [],
  arityChanged: [],
  typeOnlyRemoved: [],
  deprecated: [],
  ...over,
});

beforeEach(() => {
  handleDiffSurface.mockReset();
  handleDiffSurface.mockResolvedValue(diff());
  loadVersions.mockReset();
  loadVersions.mockResolvedValue(new Map());
});

describe('briefRepo', () => {
  it('returns an empty brief when the repo has never been scanned', async () => {
    expect(await briefRepo(db, null)).toEqual({ upgrades: [], omitted: 0, pending: 0 });
    expect(handleDiffSurface).not.toHaveBeenCalled();
  });

  it('skips dependencies already on latest', async () => {
    const brief = await briefRepo(db, drift([dep({ resolved: '2.0.0', latest: '2.0.0' })]));
    expect(brief.upgrades).toHaveLength(0);
    expect(handleDiffSurface).not.toHaveBeenCalled();
  });

  it('classifies a removal as removes-exports', async () => {
    handleDiffSurface.mockResolvedValue(diff({ removed: [{ path: 'useHistory' }] }));
    const brief = await briefRepo(db, drift([dep()]));
    expect(brief.upgrades[0]).toMatchObject({
      verdict: 'removes-exports',
      removed: ['useHistory'],
    });
  });

  it('classifies an arity change with no removals as arity-changed', async () => {
    handleDiffSurface.mockResolvedValue(
      diff({ arityChanged: [{ path: 'Router', from: 1, to: 2 }] }),
    );
    const brief = await briefRepo(db, drift([dep()]));
    expect(brief.upgrades[0]!.verdict).toBe('arity-changed');
  });

  it('never reports an unextracted surface as clean', async () => {
    // The whole point: "we did not look" and "we looked and it is fine" must
    // never collapse into the same verdict.
    handleDiffSurface.mockResolvedValue(diff({ inconclusive: 'no extracted surface for 2.0.0' }));
    const brief = await briefRepo(db, drift([dep()]));
    expect(brief.upgrades[0]!.verdict).toBe('unknown');
    expect(brief.pending).toBe(1);
  });

  it('does not treat a type-only removal as a runtime removal', async () => {
    handleDiffSurface.mockResolvedValue(diff({ typeOnlyRemoved: ['RouteProps'] }));
    const brief = await briefRepo(db, drift([dep()]));
    expect(brief.upgrades[0]!.verdict).toBe('clean');
    expect(brief.upgrades[0]!.typeOnlyRemoved).toEqual(['RouteProps']);
  });

  it('orders hazards first, then unknowns, then clean', async () => {
    handleDiffSurface.mockImplementation((_db: unknown, { package: name }: { package: string }) => {
      if (name === 'breaks') return Promise.resolve(diff({ removed: [{ path: 'gone' }] }));
      if (name === 'unsure') return Promise.resolve(diff({ inconclusive: 'not extracted' }));
      return Promise.resolve(diff());
    });
    const brief = await briefRepo(
      db,
      drift([dep({ name: 'fine' }), dep({ name: 'unsure' }), dep({ name: 'breaks' })]),
    );
    expect(brief.upgrades.map((u) => u.package)).toEqual(['breaks', 'unsure', 'fine']);
  });

  it('caps the brief and reports what it left out rather than truncating silently', async () => {
    const deps = Array.from({ length: BRIEF_CAP + 4 }, (_, i) => dep({ name: `pkg-${i}` }));
    const brief = await briefRepo(db, drift(deps));
    expect(brief.upgrades).toHaveLength(BRIEF_CAP);
    expect(brief.omitted).toBe(4);
  });

  it('plans no hops for a single-major bump', async () => {
    const brief = await briefRepo(db, drift([dep()]));
    expect(brief.upgrades[0]!.hops).toEqual([]);
    // One diff, not two: the direct comparison already is the only hop.
    expect(handleDiffSurface).toHaveBeenCalledTimes(1);
  });

  it('sequences a two-major upgrade through the middle major', async () => {
    loadVersions.mockResolvedValue(
      new Map([['pkg', ['1.0.0', '2.4.0', '3.0.0']]]),
    );
    const brief = await briefRepo(
      db,
      drift([dep({ resolved: '1.0.0', latest: '3.0.0', majorsBehind: 2 })]),
    );
    expect(brief.upgrades[0]!.hops.map((h) => `${h.fromVersion}>${h.toVersion}`)).toEqual([
      '1.0.0>2.4.0',
      '2.4.0>3.0.0',
    ]);
  });

  it('keeps the direct diff authoritative for breakage, not the union of hops', async () => {
    // Removed at 2, restored at 3: the direct 1→3 diff sees nothing gone, and
    // that is the correct answer for "will my code break".
    loadVersions.mockResolvedValue(new Map([['pkg', ['1.0.0', '2.4.0', '3.0.0']]]));
    handleDiffSurface.mockImplementation(
      (_db: unknown, { fromVersion, toVersion }: { fromVersion: string; toVersion: string }) =>
        Promise.resolve(
          fromVersion === '1.0.0' && toVersion === '2.4.0'
            ? diff({ removed: [{ path: 'gone' }] })
            : diff(),
        ),
    );
    const brief = await briefRepo(
      db,
      drift([dep({ resolved: '1.0.0', latest: '3.0.0', majorsBehind: 2 })]),
    );
    expect(brief.upgrades[0]!.removed).toEqual([]);
    expect(brief.upgrades[0]!.verdict).toBe('clean');
    expect(brief.upgrades[0]!.hops[0]!.removed).toEqual(['gone']);
  });

  it('says why a sequence was skipped rather than looking like one hop', async () => {
    const brief = await briefRepo(
      db,
      drift([dep({ resolved: '1.0.0', latest: '12.0.0', majorsBehind: 11 })]),
    );
    expect(brief.upgrades[0]!.hops).toEqual([]);
    expect(brief.upgrades[0]!.sequenceNote).toMatch(/too far to sequence/i);
  });

  it('carries every declaring manifest through to the brief', async () => {
    const declaredIn = [
      { path: 'package.json', range: '^1.0.0' },
      { path: 'packages/api/package.json', range: '^1.2.0' },
    ];
    const brief = await briefRepo(db, drift([dep({ declaredIn })]));
    expect(brief.upgrades[0]!.declaredIn).toEqual(declaredIn);
  });

  it('keeps advisories when the cap bites', async () => {
    const deps = Array.from({ length: BRIEF_CAP + 1 }, (_, i) => dep({ name: `pkg-${i}` }));
    deps[deps.length - 1] = dep({ name: 'urgent', advisories: 2 });
    const brief = await briefRepo(db, drift(deps));
    expect(brief.upgrades.map((u) => u.package)).toContain('urgent');
  });
});
