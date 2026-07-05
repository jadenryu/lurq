/**
 * Minimal per-tool metrics for the hosted MCP path — Prometheus text format, no
 * dependency. Counts calls, errors, and cumulative latency per tool so an
 * operator can see usage and error rates without wiring up an APM. Process-local
 * (a module singleton): each server instance exposes its own counters at
 * `/metrics`, which is exactly what a Prometheus scrape expects.
 */
interface Stat {
  calls: number;
  errors: number;
  totalMs: number;
}

const stats = new Map<string, Stat>();

/** Record one tool invocation. `ok=false` marks a handler that threw. */
export function recordToolCall(tool: string, ok: boolean, ms: number): void {
  const s = stats.get(tool) ?? { calls: 0, errors: 0, totalMs: 0 };
  s.calls += 1;
  if (!ok) s.errors += 1;
  s.totalMs += ms;
  stats.set(tool, s);
}

/** Time a tool handler and record the outcome, re-throwing any error unchanged. */
export async function timed<T>(tool: string, fn: () => Promise<T>): Promise<T> {
  const start = Date.now();
  let ok = false;
  try {
    const result = await fn();
    ok = true;
    return result;
  } finally {
    recordToolCall(tool, ok, Date.now() - start);
  }
}

/** Render current counters in Prometheus exposition format. */
export function renderPrometheus(): string {
  const lines = [
    '# HELP lurq_tool_calls_total Total MCP tool invocations.',
    '# TYPE lurq_tool_calls_total counter',
    '# HELP lurq_tool_errors_total MCP tool invocations that threw.',
    '# TYPE lurq_tool_errors_total counter',
    '# HELP lurq_tool_duration_ms_total Cumulative tool handler time in ms.',
    '# TYPE lurq_tool_duration_ms_total counter',
  ];
  for (const [tool, s] of stats) {
    const label = `{tool="${tool}"}`;
    lines.push(`lurq_tool_calls_total${label} ${s.calls}`);
    lines.push(`lurq_tool_errors_total${label} ${s.errors}`);
    lines.push(`lurq_tool_duration_ms_total${label} ${s.totalMs}`);
  }
  return lines.join('\n') + '\n';
}

/** Test-only: clear all counters. */
export function resetMetrics(): void {
  stats.clear();
}
