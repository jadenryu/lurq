/**
 * Why a live connection to an MCP server produced no contract, in words a user
 * can act on.
 *
 * The categories are chosen by what the user does next, not by where in the
 * stack the error was raised: a missing token, an OAuth sign-in, a typo in the
 * command and a server that crashes on boot all look like "it failed" and each
 * has a different fix. Anything unrecognised is `protocol_error` with the raw
 * (scrubbed) message, never guessed into a friendlier bucket.
 */
import { ErrorCode, McpError } from '@modelcontextprotocol/sdk/types.js';
import { UnauthorizedError } from '@modelcontextprotocol/sdk/client/auth.js';
import { StreamableHTTPError } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { SseError } from '@modelcontextprotocol/sdk/client/sse.js';

export type ScanStatus =
  /** Handshake and every list succeeded. */
  | 'ok'
  /** The tool list was read; a secondary list failed or a ceiling was hit. */
  | 'partial'
  /** A `${VAR}` has no value, or the server said it needs one. */
  | 'needs_config'
  /** 401/403, or an OAuth server lurq holds no token for. */
  | 'auth_required'
  /** Committed to a repository and not approved. Not launched. */
  | 'untrusted'
  /** `disabled: true` in its config. Not launched. */
  | 'disabled'
  /** Command not found, or exited before the handshake. */
  | 'spawn_failed'
  | 'timeout'
  /** Connection refused, DNS, TLS, 404. */
  | 'unreachable'
  /** Spoke, but not valid MCP. */
  | 'protocol_error'
  /** The user interrupted the scan. */
  | 'cancelled';

export interface Classified {
  status: ScanStatus;
  error: string;
  /** What to do about it. Null when there is nothing better than the error. */
  hint: string | null;
}

/**
 * A crash that reads like a missing setting rather than a defect.
 *
 * Deliberately narrow: it must see a SHOUTY_ENV_NAME next to a word about being
 * required. A server whose real crash merely mentions an environment variable
 * should not be excused as unconfigured, because excusing a genuine failure
 * hides it.
 *
 * ponytail: heuristic on someone else's error text. The registry manifest is
 * the real answer; delete this when enough servers publish one.
 */
const ENV_COMPLAINT =
  /\b([A-Z][A-Z0-9]{2,}(?:_[A-Z0-9]+)+)\b[^.\n]{0,60}?\b(required|must be set|not set|missing|is not defined)\b|\b(required|must be set|missing)\b[^.\n]{0,60}?\b([A-Z][A-Z0-9]{2,}(?:_[A-Z0-9]+)+)\b/;

export function sniffMissingEnv(text: string): string | null {
  const m = ENV_COMPLAINT.exec(text);
  return m ? (m[1] ?? m[4] ?? null) : null;
}

const NETWORK_CODES = new Set([
  'ECONNREFUSED',
  'ENOTFOUND',
  'EAI_AGAIN',
  'ECONNRESET',
  'ETIMEDOUT',
  'EHOSTUNREACH',
  'ENETUNREACH',
  'UND_ERR_CONNECT_TIMEOUT',
  'UND_ERR_SOCKET',
  'CERT_HAS_EXPIRED',
  'DEPTH_ZERO_SELF_SIGNED_CERT',
  'SELF_SIGNED_CERT_IN_CHAIN',
  'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
  'ERR_TLS_CERT_ALTNAME_INVALID',
]);

/** Walk `cause` chains: undici hides the useful code two levels down. */
function causeCode(err: unknown): string | null {
  let cur: unknown = err;
  for (let i = 0; i < 5 && cur; i++) {
    const code = (cur as { code?: unknown }).code;
    if (typeof code === 'string') return code;
    cur = (cur as { cause?: unknown }).cause;
  }
  return null;
}

export interface ErrorContext {
  stage: 'connect' | 'list';
  transport: 'stdio' | 'http' | 'sse';
  command: string | null;
  stderrTail: string;
  /** Non-JSON lines the server wrote to stdout. */
  stdoutNoise: number;
}

const msg = (err: unknown) => (err instanceof Error ? err.message : String(err));

export function classifyError(err: unknown, ctx: ErrorContext): Classified {
  const message = msg(err).slice(0, 500);

  if (err instanceof UnauthorizedError) {
    return {
      status: 'auth_required',
      error: message || 'the server requires authorization',
      hint: 'this server signs in with OAuth, and lurq cannot reuse the token your agent holds; ask your agent to pass its tool list to the mcp_stack tool instead',
    };
  }

  const httpCode =
    err instanceof StreamableHTTPError || err instanceof SseError ? (err as { code?: number }).code : undefined;
  if (httpCode === 401 || httpCode === 403) {
    return {
      status: 'auth_required',
      error: `HTTP ${httpCode}`,
      hint: 'the server rejected the credentials in this config; check the Authorization header or token it is given',
    };
  }
  if (typeof httpCode === 'number' && httpCode > 0) {
    return {
      status: 'unreachable',
      error: `HTTP ${httpCode}: ${message}`,
      hint: httpCode === 404 ? 'nothing answers MCP at this url; check the path' : null,
    };
  }

  if (err instanceof McpError && err.code === ErrorCode.RequestTimeout) {
    return {
      status: 'timeout',
      error: message,
      hint:
        ctx.transport === 'stdio'
          ? 'the server did not answer in time; a first run of npx/uvx downloads the package, so try again with a longer --timeout'
          : null,
    };
  }

  const code = causeCode(err);
  if (code === 'ENOENT' && ctx.transport === 'stdio') {
    return {
      status: 'spawn_failed',
      error: `command not found: ${ctx.command ?? '(none)'}`,
      hint: 'install it, or use an absolute path in the config',
    };
  }
  if (code && NETWORK_CODES.has(code)) {
    return { status: 'unreachable', error: `${code}: ${message}`, hint: null };
  }
  // undici's catch-all. The cause names the reason (a blocked port, a reset, a
  // proxy refusal) but not always with a code, and none of them are MCP faults.
  if (err instanceof TypeError && /fetch failed/i.test(message)) {
    const cause = (err as { cause?: unknown }).cause;
    return { status: 'unreachable', error: cause ? `fetch failed: ${msg(cause).slice(0, 300)}` : message, hint: null };
  }

  const closed =
    (err instanceof McpError && err.code === ErrorCode.ConnectionClosed) || /connection closed/i.test(message);

  if (closed && ctx.transport === 'stdio') {
    const missing = sniffMissingEnv(ctx.stderrTail);
    if (missing) {
      return {
        status: 'needs_config',
        error: `the server exited, and its output names ${missing} as required`,
        hint: `set ${missing} in this server's env block`,
      };
    }
    if (ctx.stdoutNoise > 0 && !ctx.stderrTail.trim()) {
      return {
        status: 'protocol_error',
        error: 'the server wrote non-protocol output to stdout and then closed',
        hint: 'stdio servers must log to stderr; stdout is reserved for JSON-RPC',
      };
    }
    return {
      status: 'spawn_failed',
      error: ctx.stderrTail.trim()
        ? `exited before completing the handshake: ${ctx.stderrTail.trim().split('\n').slice(-3).join(' | ')}`
        : 'exited before completing the handshake',
      hint: null,
    };
  }

  if (/protocol version is not supported/i.test(message)) {
    return {
      status: 'protocol_error',
      error: message,
      hint: 'the server speaks a protocol revision this lurq version does not; upgrade lurq',
    };
  }

  if (ctx.stdoutNoise > 0) {
    return {
      status: 'protocol_error',
      error: `${message} (the server also wrote ${ctx.stdoutNoise} non-protocol line(s) to stdout)`,
      hint: 'stdio servers must log to stderr; stdout is reserved for JSON-RPC',
    };
  }

  return { status: 'protocol_error', error: message || 'unknown error', hint: null };
}
