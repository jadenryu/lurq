import { describe, it, expect, vi, beforeEach } from 'vitest';

// The queue drives syncOnePackage + seed promotion in the background.
vi.mock('../src/pipeline/single', () => ({ syncOnePackage: vi.fn() }));
vi.mock('../src/db/packages', () => ({ ensureSeedEntry: vi.fn().mockResolvedValue(undefined) }));

import { enqueueIngest, ingestQueueDepth, resetIngestQueue } from '../src/pipeline/ingestQueue';
import * as single from '../src/pipeline/single';
import * as pkgs from '../src/db/packages';

const syncOnePackage = vi.mocked(single.syncOnePackage);
const ensureSeedEntry = vi.mocked(pkgs.ensureSeedEntry);
const db = {} as never;

/** Let queued microtasks run until the backlog drains. */
async function drain(): Promise<void> {
  for (let i = 0; i < 100 && ingestQueueDepth() > 0; i++) {
    await new Promise((r) => setImmediate(r));
  }
}

describe('ingestQueue', () => {
  beforeEach(() => {
    resetIngestQueue();
    vi.clearAllMocks();
  });

  it('ingests a queued package and promotes it when it clears the quality bar', async () => {
    syncOnePackage.mockResolvedValue({ confidence: 'proven', category: 'utility' } as never);
    enqueueIngest(db, 'goodpkg');
    await drain();
    expect(syncOnePackage).toHaveBeenCalledWith(db, 'goodpkg');
    expect(ensureSeedEntry).toHaveBeenCalledWith(db, 'goodpkg', 'utility');
  });

  it('ingests but does NOT promote a low-signal (unproven) package', async () => {
    syncOnePackage.mockResolvedValue({ confidence: 'unproven', category: 'utility' } as never);
    enqueueIngest(db, 'obscure');
    await drain();
    expect(syncOnePackage).toHaveBeenCalledTimes(1);
    expect(ensureSeedEntry).not.toHaveBeenCalled();
  });

  it('dedupes a name already in flight — one ingest, not two', async () => {
    let release!: () => void;
    syncOnePackage.mockImplementation(
      () => new Promise((r) => (release = () => r({ confidence: 'unproven' } as never))),
    );
    enqueueIngest(db, 'dupe');
    enqueueIngest(db, 'dupe'); // second enqueue while the first is in flight
    expect(ingestQueueDepth()).toBe(1);
    release();
    await drain();
    expect(syncOnePackage).toHaveBeenCalledTimes(1);
  });

  it('survives an ingest failure without wedging the queue', async () => {
    syncOnePackage.mockRejectedValue(new Error('network'));
    enqueueIngest(db, 'boom');
    await drain();
    expect(ingestQueueDepth()).toBe(0);
    expect(ensureSeedEntry).not.toHaveBeenCalled();
  });
});
