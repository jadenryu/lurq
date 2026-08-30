import { describe, it, expect, vi, beforeEach } from 'vitest';

// computeDrift only reads the index; the queue's downstream work is stubbed so
// the test asserts *what gets queued*, not what ingestion then does with it.
vi.mock('../src/pipeline/single', () => ({
  syncOnePackage: vi.fn().mockResolvedValue({ confidence: 'unproven', category: null }),
}));
vi.mock('../src/db/packages', () => ({ ensureSeedEntry: vi.fn().mockResolvedValue(undefined) }));

import { computeDrift } from '../src/github/drift';
import { resetIngestQueue, ingestQueueDepth } from '../src/pipeline/ingestQueue';
import * as single from '../src/pipeline/single';

const syncOnePackage = vi.mocked(single.syncOnePackage);

/**
 * Only `react` is indexed. `left-pad` and `@acme/internal` are the misses that
 * used to vanish into `depsDeclared - depsTracked` with nothing queued.
 */
const INDEXED = new Set(['react']);

/** Minimal drizzle stand-in: loadIndexed and loadVersions are both
 *  `select().from().where()` chains that resolve to a row array. */
function fakeDb() {
  return {
    select: (cols: Record<string, unknown>) => ({
      from: () => ({
        where: async () =>
          'version' in cols
            ? [] // loadVersions: no timeline needed for this assertion
            : [...INDEXED].map((name) => ({
                name,
                latestVersion: '19.0.0',
                deprecated: false,
                advisories: [],
              })),
      }),
    }),
  } as never;
}

/** Let the dynamic import + queue microtasks settle. */
async function settle(): Promise<void> {
  for (let i = 0; i < 50; i++) await new Promise((r) => setImmediate(r));
}

describe('computeDrift → untracked dependency enqueue', () => {
  beforeEach(() => {
    resetIngestQueue();
    vi.clearAllMocks();
  });

  it('queues every declared dependency the index has never seen', async () => {
    const drift = await computeDrift(
      fakeDb(),
      [
        {
          path: 'package.json',
          deps: { react: '^19.0.0', 'left-pad': '^1.3.0', '@acme/internal': '^2.0.0' },
        },
      ],
      null,
      'owner_123',
    );
    await settle();

    expect(drift.depsDeclared).toBe(3);
    expect(drift.depsTracked).toBe(1);

    const queued = syncOnePackage.mock.calls.map((c) => c[1]).sort();
    expect(queued).toEqual(['@acme/internal', 'left-pad']);
    // Attributed to the user whose repo surfaced them.
    expect(syncOnePackage).toHaveBeenCalledWith(expect.anything(), 'left-pad', {
      requestedByOwnerId: 'owner_123',
    });
  });

  it('queues nothing when every declared dependency is already indexed', async () => {
    await computeDrift(fakeDb(), [{ path: 'package.json', deps: { react: '^19.0.0' } }]);
    await settle();

    expect(ingestQueueDepth()).toBe(0);
    expect(syncOnePackage).not.toHaveBeenCalled();
  });
});
