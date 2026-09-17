/**
 * One identity per remote endpoint.
 *
 * The registry is hand-written: the same server shows up as `HTTPS://Mcp.X.dev/mcp`
 * in one entry and `https://mcp.x.dev/mcp` in another, and a probe queue keyed on
 * raw strings would probe it twice and report two histories for one server. The
 * canonical form only folds what URLs define as equivalent — scheme and host case,
 * a default port, a fragment, a bare trailing slash — and never touches path or
 * query, which the server is free to treat as meaningful.
 */

export interface EndpointIdentity {
  /** Canonical URL: the queue key. */
  url: string;
  /** Lowercased hostname, for per-host politeness. */
  host: string;
  /** Contains `{placeholders}` the user must fill in before anything can connect. */
  templated: boolean;
}

const PLACEHOLDER = /\{[^{}]+\}/;

export function endpointIdentity(raw: string): EndpointIdentity | null {
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  if (!trimmed || trimmed.length > 2_048) return null;
  const templated = PLACEHOLDER.test(trimmed);
  // A placeholder in the host (`https://{tenant}.x.dev`) is not a parseable URL;
  // substitute a neutral label only to read the parts, and keep the raw text.
  let parsed: URL;
  try {
    parsed = new URL(templated ? trimmed.replace(/\{[^{}]+\}/g, 'placeholder') : trimmed);
  } catch {
    return null;
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return null;
  const host = parsed.hostname.toLowerCase();
  if (!host) return null;
  if (templated) return { url: trimmed, host, templated: true };

  parsed.hash = '';
  const path = parsed.pathname === '/' ? '' : parsed.pathname;
  const port = parsed.port ? `:${parsed.port}` : '';
  const auth = parsed.username ? `${parsed.username}${parsed.password ? `:${parsed.password}` : ''}@` : '';
  return { url: `${parsed.protocol}//${auth}${host}${port}${path}${parsed.search}`, host, templated: false };
}
