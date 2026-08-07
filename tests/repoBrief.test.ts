import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { DepDrift, RepoDrift } from '../src/github/types';

const handleDiffSurface = vi.fn();
vi.mock('../src/mcp/surfaceHandlers', () => ({ handleDiffSurface }));

const { briefRepo, BRIEF_CAP } = await import('../src/github/brief');

const db = {} as never;

function dep(over: Partial<DepDrift> = {}): DepDrift {
  return {
    name: 'pkg',
    range: '^1.0.0',
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

  it('keeps advisories when the cap bites', async () => {
    const deps = Array.from({ length: BRIEF_CAP + 1 }, (_, i) => dep({ name: `pkg-${i}` }));
    deps[deps.length - 1] = dep({ name: 'urgent', advisories: 2 });
    const brief = await briefRepo(db, drift(deps));
    expect(brief.upgrades.map((u) => u.package)).toContain('urgent');
  });
});
