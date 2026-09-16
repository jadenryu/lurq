/**
 * MCP probe queue retries: which outcomes come back, how many times, and with
 * how much room. The backoff itself is SQL (db/surface.ts bumpSurfaceAttempt).
 */
import { describe, expect, it } from 'vitest';
import { MAX_PAGES } from '../src/graph/oracles/mcpServer';
import { probeScript } from '../src/graph/oracles/mcpServer';
import { mcpQueueAction, probePageCeiling, type McpOutcome } from '../src/pipeline/mcp';

describe('mcpQueueAction', () => {
  it('retries a truncated list and an unreachable server while attempts remain', () => {
    expect(mcpQueueAction('truncated', 0)).toBe('retry');
    expect(mcpQueueAction('unreachable', 1)).toBe('retry');
  });

  it('gives up on them once the attempt budget is spent', () => {
    expect(mcpQueueAction('truncated', 2)).toBe('drop');
    expect(mcpQueueAction('unreachable', 2)).toBe('drop');
  });

  it('drops settled answers on the first attempt', () => {
    const settled: McpOutcome[] = ['stored', 'cached', 'undeclared', 'needs_config', 'not_stdio'];
    for (const outcome of settled) expect(mcpQueueAction(outcome, 0)).toBe('drop');
  });
});

describe('probePageCeiling', () => {
  it('starts at MAX_PAGES and quadruples per prior attempt', () => {
    expect(probePageCeiling(0)).toBe(MAX_PAGES);
    expect(probePageCeiling(1)).toBe(MAX_PAGES * 4);
    expect(probePageCeiling(2)).toBe(MAX_PAGES * 16);
  });
});

describe('probeScript page ceiling', () => {
  it('embeds the requested ceiling, defaulting to MAX_PAGES', () => {
    expect(probeScript('srv')).toContain(`pages < ${MAX_PAGES})`);
    expect(probeScript('srv', [], {}, 800)).toContain('pages < 800)');
  });
});
