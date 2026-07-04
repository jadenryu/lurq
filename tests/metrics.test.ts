import { describe, it, expect, beforeEach } from 'vitest';
import { recordToolCall, renderPrometheus, resetMetrics, timed } from '../src/mcp/metrics';

describe('metrics', () => {
  beforeEach(() => resetMetrics());

  it('counts calls, errors, and latency per tool', () => {
    recordToolCall('recommend', true, 10);
    recordToolCall('recommend', false, 20);
    const out = renderPrometheus();
    expect(out).toContain('lurq_tool_calls_total{tool="recommend"} 2');
    expect(out).toContain('lurq_tool_errors_total{tool="recommend"} 1');
    expect(out).toContain('lurq_tool_duration_ms_total{tool="recommend"} 30');
  });

  it('records a thrown handler as an error and re-throws', async () => {
    await expect(
      timed('verify', async () => {
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
    expect(renderPrometheus()).toContain('lurq_tool_errors_total{tool="verify"} 1');
  });

  it('records a successful handler as ok', async () => {
    const r = await timed('evaluate', async () => 42);
    expect(r).toBe(42);
    const out = renderPrometheus();
    expect(out).toContain('lurq_tool_calls_total{tool="evaluate"} 1');
    expect(out).toContain('lurq_tool_errors_total{tool="evaluate"} 0');
  });
});
