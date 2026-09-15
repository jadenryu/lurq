/**
 * On-demand ingests survive a restart: each request is written to
 * `discovery_queue` before it runs, and its outcome is written back, so the
 * hourly worker can finish anything a deploy interrupted.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/pipeline/single', () => ({ syncOnePackage: vi.fn() }));
vi.mock('../src/db/packages', () => ({ ensureSeedEntry: vi.fn().mockResolvedValue(undefined) }));
vi.mock('../src/db/discovery', () => ({
  enqueueDemand: vi.fn().mockResolvedValue(undefined),
  setDiscoveryStatus: vi.fn().mockResolvedValue(undefined),
  recordIngestFailure: vi.fn().mockResolvedValue(1),
}));

import * as discoveryDb from '../src/db/discovery';
import { enqueueIngest, ingestQueueDepth, resetIngestQueue, runIngest } from '../src/pipeline/ingestQueue';
import { pickIngestOrder } from '../src/pipeline/discovery';
import * as single from '../src/pipeline/single';
import { DISCOVERY } from '../src/scoring/weights';

const syncOnePackage = vi.mocked(single.syncOnePackage);
const db = {} as never;

async function drain(): Promise<void> {
  for (let i = 0; i < 100 && ingestQueueDepth() > 0; i++) {
    await new Promise((r) => setImmediate(r));
  }
}

describe('durable on-demand ingest', () => {
  beforeEach(() => {
    resetIngestQueue();
    vi.clearAllMocks();
  });

  it('records the request, with its requester, the moment it is queued', () => {
    syncOnePackage.mockImplementation(() => new Promise(() => {})); // never finishes
    enqueueIngest(db, 'zod', 'user_1');
    expect(discoveryDb.enqueueDemand).toHaveBeenCalledWith(db, 'zod', 'user_1');
  });

  it('marks the row ingested when the ingest succeeds', async () => {
    syncOnePackage.mockResolvedValue({ confidence: 'unproven', category: null } as never);
    enqueueIngest(db, 'zod', null);
    await drain();
    expect(discoveryDb.setDiscoveryStatus).toHaveBeenCalledWith(db, 'zod', { status: 'ingested' });
    expect(discoveryDb.recordIngestFailure).not.toHaveBeenCalled();
  });

  it('counts a failure against the shared attempt budget', async () => {
    syncOnePackage.mockRejectedValue(new Error('registry 500'));
    const row = await runIngest(db, 'broken-pkg', null);
    expect(row).toBeNull();
    expect(discoveryDb.recordIngestFailure).toHaveBeenCalledWith(
      db,
      'broken-pkg',
      DISCOVERY.maxIngestAttempts,
    );
  });

  it('still ingests when the durable write fails', async () => {
    vi.mocked(discoveryDb.enqueueDemand).mockRejectedValueOnce(new Error('db down'));
    syncOnePackage.mockResolvedValue({ confidence: 'unproven', category: null } as never);
    const row = await runIngest(db, 'zod', null);
    expect(row).not.toBeNull();
  });
});

describe('pickIngestOrder', () => {
  const gated = [
    { name: 'mid', preScore: 60 },
    { name: 'best', preScore: 90 },
    { name: 'low', preScore: 46 },
  ];

  it('puts user requests ahead of every gate survivor', () => {
    const { ingest } = pickIngestOrder([{ name: 'asked-for', requestedByOwnerId: 'u' }], gated, 10);
    expect(ingest.map((p) => p.name)).toEqual(['asked-for', 'best', 'mid', 'low']);
    expect(ingest[0]!.requestedByOwnerId).toBe('u');
    expect(ingest[1]!.requestedByOwnerId).toBeNull();
  });

  it('applies one cap across both, deferring the lowest-ranked tail', () => {
    const { ingest, deferred } = pickIngestOrder([{ name: 'asked-for', requestedByOwnerId: null }], gated, 2);
    expect(ingest.map((p) => p.name)).toEqual(['asked-for', 'best']);
    expect(deferred.map((p) => p.name)).toEqual(['mid', 'low']);
  });
});
