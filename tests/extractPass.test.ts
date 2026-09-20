/**
 * The worker's surface-extraction pass: failures spend a version's attempt
 * budget, successes are handed to the symbol store while the queue has room.
 */
import { describe, expect, it, vi } from 'vitest';
import { recordExtractOutcomes, type ExtractPassIo } from '../src/pipeline/worker';

function io(over: Partial<ExtractPassIo> = {}): ExtractPassIo {
  return {
    recordMiss: vi.fn(async () => undefined),
    hasSymbolSurface: vi.fn(async () => false),
    enqueueSymbolSurface: vi.fn(async () => undefined),
    queueDepth: vi.fn(async () => 0),
    headroom: 20,
    ...over,
  };
}

describe('recordExtractOutcomes', () => {
  it('counts a failed extraction against that version, and queues nothing for it', async () => {
    const deps = io();
    const queued = await recordExtractOutcomes(
      [{ name: 'no-types', version: '1.0.0', ok: false }],
      deps,
    );
    expect(deps.recordMiss).toHaveBeenCalledWith('no-types', '1.0.0');
    expect(deps.enqueueSymbolSurface).not.toHaveBeenCalled();
    expect(queued).toBe(0);
  });

  it('hands a success to the symbol store when it is not there yet', async () => {
    const deps = io();
    const queued = await recordExtractOutcomes([{ name: 'zod', version: '4.0.0', ok: true }], deps);
    expect(deps.enqueueSymbolSurface).toHaveBeenCalledWith('zod', '4.0.0');
    expect(deps.recordMiss).not.toHaveBeenCalled();
    expect(queued).toBe(1);
  });

  it('skips a success the symbol store already has', async () => {
    const deps = io({ hasSymbolSurface: vi.fn(async () => true) });
    expect(await recordExtractOutcomes([{ name: 'zod', version: '4.0.0', ok: true }], deps)).toBe(
      0,
    );
    expect(deps.enqueueSymbolSurface).not.toHaveBeenCalled();
  });

  it('stops queueing at the headroom so demand-driven misses never wait behind it', async () => {
    const deps = io({ queueDepth: vi.fn(async () => 18) });
    const results = ['a', 'b', 'c', 'd'].map((name) => ({ name, version: '1.0.0', ok: true }));
    expect(await recordExtractOutcomes(results, deps)).toBe(2);
    expect(deps.enqueueSymbolSurface).toHaveBeenCalledTimes(2);
  });

  it('still records failures when the queue is already full', async () => {
    const deps = io({ queueDepth: vi.fn(async () => 99) });
    await recordExtractOutcomes(
      [
        { name: 'ok', version: '1.0.0', ok: true },
        { name: 'bad', version: '2.0.0', ok: false },
      ],
      deps,
    );
    expect(deps.recordMiss).toHaveBeenCalledWith('bad', '2.0.0');
    expect(deps.enqueueSymbolSurface).not.toHaveBeenCalled();
  });
});
