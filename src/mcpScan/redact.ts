/**
 * Credential scrubbing for anything a scan stores, prints or uploads.
 *
 * A server's output is not trusted to be clean. Error text echoes the config it
 * failed on, stderr prints the token it was handed, and a schema's `default` can
 * carry whatever the author had in their environment when they generated it.
 * Two passes cover that: the exact values this spec was configured with (known
 * locally, never sent), and the shapes of common key formats (for secrets the
 * server found somewhere else).
 */

/** Well-known credential formats. Anchored per token, so prose is left alone. */
const SHAPES: RegExp[] = [
  /\bsk-(?:ant-|proj-)?[A-Za-z0-9_-]{16,}/g,
  /\bgh[pousr]_[A-Za-z0-9]{20,}/g,
  /\bgithub_pat_[A-Za-z0-9_]{20,}/g,
  /\bxox[abpors]-[A-Za-z0-9-]{10,}/g,
  /\bAKIA[0-9A-Z]{16}\b/g,
  /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g,
  /\blurq_(?:live|test)_[A-Za-z0-9_-]{16,}/g,
  /\b(?:sk|rk|pk)_(?:live|test)_[A-Za-z0-9]{16,}/g,
];

/** `Bearer <token>` keeps the scheme, which is useful in an error, and loses the token. */
const BEARER = /\b(Bearer|Basic|token)\s+[A-Za-z0-9._~+/=-]{12,}/gi;

export const REDACTED = '[redacted]';

/** Does this whole string look like a credential? */
export function looksLikeSecret(value: string): boolean {
  return SHAPES.some((re) => {
    re.lastIndex = 0;
    const m = re.exec(value);
    return m !== null && m.index === 0 && m[0].length === value.length;
  });
}

/**
 * Replace every known secret value and credential shape in `text`.
 *
 * `secrets` must be longest first (as `collectSecrets` returns them) so a token
 * is removed whole before a shorter value that is its prefix can split it.
 */
export function scrub(text: string, secrets: readonly string[] = []): string {
  let out = text;
  for (const s of secrets) if (s && out.includes(s)) out = out.split(s).join(REDACTED);
  for (const re of SHAPES) out = out.replace(re, REDACTED);
  return out.replace(BEARER, `$1 ${REDACTED}`);
}

/**
 * Scrub every string inside a JSON value, keys included.
 *
 * Keys too: a schema's `properties` can be keyed by whatever a server decided
 * to name things, and a generated schema has been seen keyed by a real value.
 */
export function scrubDeep<T>(value: T, secrets: readonly string[] = []): T {
  if (typeof value === 'string') return scrub(value, secrets) as T;
  if (Array.isArray(value)) return value.map((v) => scrubDeep(v, secrets)) as T;
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[scrub(k, secrets)] = scrubDeep(v, secrets);
    }
    return out as T;
  }
  return value;
}
