/**
 * Compact error formatting for logs. Drizzle stuffs full SQL + every bind param
 * into `err.message`, which can be megabytes for a fat batch insert — and the
 * real Postgres reason lives on `err.cause`, which bare `err.message` drops.
 */

const DEFAULT_MAX = 300;

function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max)}…`;
}

function causeText(cause: unknown): string | null {
  if (cause == null) return null;
  if (cause instanceof Error) {
    const code =
      'code' in cause && (typeof cause.code === 'string' || typeof cause.code === 'number')
        ? String(cause.code)
        : null;
    const msg = truncate(cause.message, DEFAULT_MAX);
    return code ? `${code}: ${msg}` : msg;
  }
  if (typeof cause === 'object' && cause !== null && 'message' in cause) {
    const msg = truncate(String((cause as { message: unknown }).message), DEFAULT_MAX);
    const code =
      'code' in cause ? String((cause as { code: unknown }).code) : null;
    return code ? `${code}: ${msg}` : msg;
  }
  return truncate(String(cause), DEFAULT_MAX);
}

/** Truncated message + optional Postgres/Drizzle cause for safe logging. */
export function formatError(err: unknown, max = DEFAULT_MAX): string {
  const message =
    err instanceof Error ? truncate(err.message, max) : truncate(String(err), max);
  const cause = err instanceof Error ? causeText(err.cause) : null;
  return cause ? `${message} (cause: ${cause})` : message;
}
