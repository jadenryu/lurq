/**
 * Compact MCP responses (§12.4). Every tool response is JSON injected straight
 * into the calling agent's context window, so each `"field":null` is tokens the
 * user pays for on every call, and noise that dilutes the agent's attention.
 * `compact()` recursively drops null/undefined values.
 *
 * Deliberately KEEPS `false` and `0`: `deprecated:false` and `weeklyDownloads:0`
 * carry meaning an agent shouldn't have to infer from a field's absence.
 *
 * Deliberately KEEPS containers, including empty ones. This used to drop `[]`
 * and `{}` too, and that broke every contract built on a list: a clean verdict's
 * `reasons: []` vanished and `lurq verify` crashed iterating it, `diff_surface`
 * promised "present-but-empty" lists that never arrived, a policy's `excluded`
 * ("always present, even when empty") was absent exactly when nothing was
 * refused, and an audit item with no findings lost its `findings`. An empty list
 * is an answer ("checked, nothing found"); a missing one is not. Callers iterate
 * and dereference containers, so their shape is contract, while a null scalar is
 * a leaf nobody dereferences. The token trade is small: `"x":[]` is ~3 tokens,
 * and handlers already cap the lists that can grow.
 *
 * An explicit allowlist of must-keep keys was the other option. It was rejected
 * because it fails open: the next handler that returns a list has to remember to
 * register it, and forgetting reproduces this bug silently.
 *
 * So the rule for a handler author: absent = unknown. A null that must be read
 * as "not checked yet" is conveyed by that absence plus the prose that already
 * says so (`verdict.unknowns`, a risk flag), never by collapsing it to `[]`/`0`.
 */
export function compact<T>(value: T): T {
  // A Date is an object with no own keys, so the generic object walk below would
  // turn it into `{}`. Handlers stringify their dates today; this keeps the first
  // one that forgets from silently losing data.
  if (value instanceof Date) return value;
  if (Array.isArray(value)) {
    return value
      .filter((v) => v !== null && v !== undefined)
      .map((v) => compact(v)) as unknown as T;
  }
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
      if (raw === null || raw === undefined) continue;
      out[key] = compact(raw);
    }
    return out as T;
  }
  return value;
}
