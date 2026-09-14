/**
 * Which coding agent a hosted call came from: attribution without CLI telemetry.
 *
 * Two sources, both already on the request. `X-Lurq-Client` is the agent id
 * `lurq setup` writes into that agent's MCP config (installSkill.ts), and
 * `clientInfo` is what any MCP client sends on `initialize`, which also covers a
 * config written by hand. Both are labels the client chose, trusted for a
 * breakdown and nothing else, so each is reduced to a short plain token or
 * dropped rather than stored as whatever arrived.
 */

const TOKEN = /^[a-z0-9][a-z0-9._-]{0,39}$/i;

/** The agent id from the header (or a query parameter), or null when absent or not a plain token. */
export function agentClient(value: unknown): string | null {
  const raw = Array.isArray(value) ? value[0] : value;
  if (typeof raw !== 'string') return null;
  const token = raw.trim();
  return TOKEN.test(token) ? token.toLowerCase() : null;
}

/** The client's self-reported name and version when the body is (or contains) an `initialize`; null otherwise. */
export function initializeInfo(body: unknown): { name: string | null; version: string | null } | null {
  const messages = Array.isArray(body) ? body : [body];
  const init = messages.find((m) => (m as { method?: unknown } | null)?.method === 'initialize') as
    | { params?: { clientInfo?: { name?: unknown; version?: unknown } } }
    | undefined;
  if (!init) return null;
  const clip = (v: unknown, max: number) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null);
  return { name: clip(init.params?.clientInfo?.name, 64), version: clip(init.params?.clientInfo?.version, 32) };
}
