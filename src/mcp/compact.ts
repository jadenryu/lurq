/**
 * Compact MCP responses (§12.4). Every tool response is JSON injected straight
 * into the calling agent's context window, so each `"field":null` or empty
 * container is tokens the user pays for on every call — and noise that dilutes
 * the agent's attention. `compact()` recursively drops null/undefined values,
 * empty arrays, and objects that become empty, keeping only signal.
 *
 * Deliberately KEEPS `false` and `0`: `deprecated:false` and `weeklyDownloads:0`
 * carry meaning an agent shouldn't have to infer from a field's absence. Only
 * genuinely-absent data (null/undefined/empty) is stripped.
 */
function isEmptyObject(value: unknown): boolean {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    Object.keys(value).length === 0
  );
}

export function compact<T>(value: T): T {
  if (Array.isArray(value)) {
    return value
      .map((v) => compact(v))
      .filter((v) => v !== null && v !== undefined) as unknown as T;
  }
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
      if (raw === null || raw === undefined) continue;
      const cleaned = compact(raw);
      if (cleaned === null || cleaned === undefined) continue;
      if (Array.isArray(cleaned) && cleaned.length === 0) continue;
      if (isEmptyObject(cleaned)) continue;
      out[key] = cleaned;
    }
    return out as T;
  }
  return value;
}
