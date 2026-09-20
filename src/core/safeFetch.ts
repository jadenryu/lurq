/**
 * A `fetch` for URLs lurq did not choose.
 *
 * The remote MCP probe reads endpoints published by thousands of strangers into
 * the official registry, and `connect_check` reads one a user pastes. Both are
 * server-side requests to caller-chosen addresses, which is SSRF by definition:
 * a registry entry pointing at 169.254.169.254 or a Railway-private hostname
 * would otherwise make lurq fetch from inside its own network.
 *
 * `notify/safeHttp.ts` solves this for one POST with a 4KB reply. The probe needs
 * more — real `Response` objects the MCP SDK transports accept (streamed SSE
 * bodies included), GETs for OAuth discovery, and redirects — so this wraps
 * undici's fetch with the same three layers:
 *
 *   1. policy — every URL, including every redirect hop, must be https with no
 *      embedded credentials and no local-only hostname or private IP literal
 *   2. resolution — the socket's lookup hook refuses private addresses at
 *      CONNECT time, so a DNS answer that changes after the policy check
 *      (rebinding) is still caught
 *   3. bounds — redirects are followed by hand up to a limit, headers must
 *      arrive within a timeout, and a body past `maxBytes` errors instead of
 *      being buffered
 *
 * undici is imported directly rather than passing a dispatcher to Node's global
 * fetch: Node bundles its own undici, and a dispatcher from a different major
 * version is not guaranteed to be accepted.
 */
import { isIP } from 'node:net';
import { Agent, fetch as undiciFetch } from 'undici';
import { isPrivateAddress, safeLookup } from '../notify/safeHttp';

export const SAFE_FETCH_DEFAULTS = {
  /** Time allowed for response headers. Streams are not cut off after that. */
  headersTimeoutMs: 10_000,
  /** Silence allowed between body chunks. */
  bodyTimeoutMs: 30_000,
  /** Discovery documents are kilobytes; a tool list rarely passes a megabyte. */
  maxBytes: 5_000_000,
  maxRedirects: 3,
  userAgent: 'lurq-probe/1 (+https://lurq.run/probe)',
} as const;

const REDIRECTS = new Set([301, 302, 303, 307, 308]);
const LOCAL_SUFFIXES = ['.localhost', '.local', '.internal', '.home.arpa', '.lan'];

export class UnsafeUrlError extends Error {
  readonly code = 'EUNSAFE';
  constructor(message: string) {
    super(message);
    this.name = 'UnsafeUrlError';
  }
}

export class ResponseTooLargeError extends Error {
  readonly code = 'ETOOLARGE';
  constructor(limit: number) {
    super(`response body exceeded ${limit} bytes`);
    this.name = 'ResponseTooLargeError';
  }
}

/** Throws UnsafeUrlError when a URL is not one lurq may fetch on someone's behalf. */
export type UrlPolicy = (url: URL) => void;

/** The production policy: public https only. */
export const publicHttpsOnly: UrlPolicy = (url) => {
  if (url.protocol !== 'https:')
    throw new UnsafeUrlError(`only https URLs can be checked (got ${url.protocol})`);
  if (url.username || url.password)
    throw new UnsafeUrlError('URLs with embedded credentials are refused');
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (!host || host === 'localhost' || LOCAL_SUFFIXES.some((s) => host.endsWith(s))) {
    throw new UnsafeUrlError(`${host || 'that host'} is not reachable on the public internet`);
  }
  if (isIP(host) && isPrivateAddress(host)) {
    throw new UnsafeUrlError(`${host} is a private or reserved address`);
  }
};

export interface SafeFetchOptions {
  policy?: UrlPolicy;
  /** Socket lookup; defaults to one that refuses private addresses. */
  lookup?: ReturnType<typeof safeLookup>;
  headersTimeoutMs?: number;
  bodyTimeoutMs?: number;
  maxBytes?: number;
  maxRedirects?: number;
  userAgent?: string;
}

export type SafeFetch = ((input: string | URL, init?: RequestInit) => Promise<Response>) & {
  /** Close the connection pool. Long-lived owners never need it; a `--once` process does, or keep-alive sockets hold it open. */
  close?: () => Promise<void>;
};

function parse(input: string | URL): URL {
  try {
    return new URL(input.toString());
  } catch {
    throw new UnsafeUrlError('not a valid URL');
  }
}

/** Wrap a body so reading past `limit` bytes errors rather than buffering. */
function capped(body: ReadableStream<Uint8Array>, limit: number): ReadableStream<Uint8Array> {
  let seen = 0;
  return body.pipeThrough(
    new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        seen += chunk.byteLength;
        if (seen > limit) controller.error(new ResponseTooLargeError(limit));
        else controller.enqueue(chunk);
      },
    }),
  );
}

/**
 * Build a fetch bound to one connection pool. Create one per long-lived consumer
 * (the probe drain, the HTTP server) and reuse it; the pool is the point.
 */
export function createSafeFetch(opts: SafeFetchOptions = {}): SafeFetch {
  const policy = opts.policy ?? publicHttpsOnly;
  const maxBytes = opts.maxBytes ?? SAFE_FETCH_DEFAULTS.maxBytes;
  const maxRedirects = opts.maxRedirects ?? SAFE_FETCH_DEFAULTS.maxRedirects;
  const userAgent = opts.userAgent ?? SAFE_FETCH_DEFAULTS.userAgent;
  const dispatcher = new Agent({
    connect: { lookup: (opts.lookup ?? safeLookup()) as never },
    headersTimeout: opts.headersTimeoutMs ?? SAFE_FETCH_DEFAULTS.headersTimeoutMs,
    bodyTimeout: opts.bodyTimeoutMs ?? SAFE_FETCH_DEFAULTS.bodyTimeoutMs,
  });

  const safeFetch: SafeFetch = async (input, init = {}) => {
    let url = parse(input);
    let method = (init.method ?? 'GET').toUpperCase();
    let body = init.body ?? null;
    const headers = new Headers(init.headers);
    if (!headers.has('user-agent')) headers.set('user-agent', userAgent);

    for (let hop = 0; ; hop++) {
      policy(url);
      const res = (await undiciFetch(url, {
        method,
        headers: headers as never,
        body: body as never,
        redirect: 'manual',
        signal: init.signal ?? undefined,
        dispatcher,
      })) as unknown as Response;

      const location = res.headers.get('location');
      if (REDIRECTS.has(res.status) && location) {
        await res.body?.cancel().catch(() => {});
        if (hop >= maxRedirects) throw new UnsafeUrlError(`more than ${maxRedirects} redirects`);
        url = parse(new URL(location, url));
        // Fetch spec: 303 always becomes GET; 301/302 turn a POST into GET.
        if (
          res.status === 303 ||
          ((res.status === 301 || res.status === 302) && method === 'POST')
        ) {
          method = 'GET';
          body = null;
          headers.delete('content-type');
        }
        continue;
      }

      // `Response.url` is how callers learn where a redirect chain ended; a
      // constructed Response has none, so it is set explicitly.
      const final = res.body
        ? new Response(capped(res.body, maxBytes), {
            status: res.status,
            statusText: res.statusText,
            headers: res.headers,
          })
        : res;
      if (final !== res || !res.url) Object.defineProperty(final, 'url', { value: url.toString() });
      return final;
    }
  };
  safeFetch.close = () => dispatcher.close();
  return safeFetch;
}

let shared: SafeFetch | null = null;

/** One pool for a long-lived process (the hosted server), created on first use and never closed. */
export function sharedSafeFetch(): SafeFetch {
  shared ??= createSafeFetch();
  return shared;
}
