import { describe, it, expect, vi, beforeEach } from 'vitest';

// The queue drives syncOnePackage in the background and records each request in discovery_queue.
vi.mock('../src/pipeline/single', () => ({ syncOnePackage: vi.fn() }));
vi.mock('../src/db/discovery', () => ({
  enqueueDemand: vi.fn().mockResolvedValue(undefined),
  setDiscoveryStatus: vi.fn().mockResolvedValue(undefined),
  recordIngestFailure: vi.fn().mockResolvedValue(1),
}));

import {
  drainIngestQueue,
  enqueueIngest,
  ingestQueueDepth,
  resetIngestQueue,
} from '../src/pipeline/ingestQueue';
import * as single from '../src/pipeline/single';

const syncOnePackage = vi.mocked(single.syncOnePackage);
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

  it('ingests a queued package without adding it to the seed list, however well it scores', async () => {
    syncOnePackage.mockResolvedValue({ confidence: 'proven', category: 'utility' } as never);
    enqueueIngest(db, 'goodpkg');
    await drain();
    expect(syncOnePackage).toHaveBeenCalledWith(db, 'goodpkg', { requestedByOwnerId: null });
  });

  it('ingests a low-signal (unproven) package the same way', async () => {
    syncOnePackage.mockResolvedValue({ confidence: 'unproven', category: 'utility' } as never);
    enqueueIngest(db, 'obscure');
    await drain();
    expect(syncOnePackage).toHaveBeenCalledTimes(1);
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
  });

  it('threads the requesting ownerId through to syncOnePackage (contribution attribution)', async () => {
    syncOnePackage.mockResolvedValue({ confidence: 'unproven' } as never);
    enqueueIngest(db, 'attributed', 'user_x');
    await drain();
    expect(syncOnePackage).toHaveBeenCalledWith(db, 'attributed', { requestedByOwnerId: 'user_x' });
  });

  it('credits the FIRST requester when the same name is enqueued twice (dedup keeps owner)', async () => {
    let release!: () => void;
    syncOnePackage.mockImplementation(
      () => new Promise((r) => (release = () => r({ confidence: 'unproven' } as never))),
    );
    enqueueIngest(db, 'dupe', 'user_a');
    enqueueIngest(db, 'dupe', 'user_b'); // deduped while in flight — owner must stay user_a
    release();
    await drain();
    expect(syncOnePackage).toHaveBeenCalledTimes(1);
    expect(syncOnePackage).toHaveBeenCalledWith(db, 'dupe', { requestedByOwnerId: 'user_a' });
  });
});

describe('drainIngestQueue', () => {
  beforeEach(() => {
    resetIngestQueue();
    vi.clearAllMocks();
  });

  it('resolves only once the backlog is empty', async () => {
    // The bug this guards: a one-shot cron closing its DB pool the instant the
    // scan returns, killing every ingest the scan had just queued.
    let release!: () => void;
    syncOnePackage.mockImplementation(
      () => new Promise((r) => (release = () => r({ confidence: 'unproven' } as never))),
    );
    enqueueIngest(db, 'slowpkg');
    await new Promise((r) => setImmediate(r));
    expect(ingestQueueDepth()).toBe(1);

    const drained = drainIngestQueue(5_000);
    release();
    expect(await drained).toBe(0);
  });

  it('gives up at the deadline and reports what it left behind', async () => {
    syncOnePackage.mockImplementation(() => new Promise(() => {})); // never settles
    enqueueIngest(db, 'stuck');
    expect(await drainIngestQueue(300)).toBe(1);
  });
});
