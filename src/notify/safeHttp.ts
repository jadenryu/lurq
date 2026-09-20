/**
 * Posting to a URL a user gave us, without letting that URL reach anything it
 * should not.
 *
 * A webhook feature is a server-side request to an address chosen by a
 * customer, which is the textbook SSRF: point it at 169.254.169.254, a private
 * Railway hostname or localhost and the API server makes the request from inside
 * the network. Three layers:
 *   1. validation — https only, no credentials in the URL, known hosts for the
 *      named providers, and the retired Teams connector hosts refused
 *   2. resolution — every address the hostname resolves to is checked, at
 *      CONNECT time through the socket's lookup hook, so a DNS answer that
 *      changes between check and connect (rebinding) is still caught
 *   3. no redirects are followed, a hard timeout, and the response body is read
 *      only up to a few kilobytes
 */
import { lookup as dnsLookup, type LookupAddress } from 'node:dns';
import https from 'node:https';
import { isIP } from 'node:net';

export type ChannelKind = 'slack' | 'discord' | 'teams' | 'webhook';

const MAX_URL = 2_000;
const TIMEOUT_MS = 10_000;
const MAX_RESPONSE = 4_000;

function v4Private(ip: string): boolean {
  const [a = 0, b = 0] = ip.split('.').map(Number);
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) || // carrier-grade NAT
    (a === 169 && b === 254) || // link-local, cloud metadata
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 192 && b === 0) ||
    (a === 198 && (b === 18 || b === 19)) || // benchmarking
    a >= 224 // multicast and reserved
  );
}

/** Is this address anywhere a public webhook could not legitimately live? */
export function isPrivateAddress(ip: string): boolean {
  const kind = isIP(ip);
  if (kind === 4) return v4Private(ip);
  if (kind !== 6) return true; // not an address at all: refuse
  const v = ip.toLowerCase();
  if (v === '::' || v === '::1') return true;
  const mapped = /^::ffff:(.+)$/.exec(v);
  if (mapped) {
    const rest = mapped[1]!;
    if (isIP(rest) === 4) return v4Private(rest);
    // ::ffff:a00:1 — the hex spelling of a mapped IPv4 address
    const [hi = '0', lo = '0'] = rest.split(':');
    const n = (parseInt(hi, 16) << 16) | parseInt(lo, 16);
    return v4Private([(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255].join('.'));
  }
  return /^f[cd]/.test(v) || /^fe[89ab]/.test(v) || v.startsWith('ff');
}

const SLACK_HOSTS = new Set(['hooks.slack.com']);
const DISCORD_HOSTS = new Set([
  'discord.com',
  'discordapp.com',
  'ptb.discord.com',
  'canary.discord.com',
]);
const TEAMS_SUFFIXES = ['.logic.azure.com', '.powerplatform.com', '.powerautomate.com'];

export type UrlCheck = { ok: true; url: URL } | { ok: false; error: string };

export function validateChannelUrl(kind: ChannelKind, raw: string): UrlCheck {
  if (typeof raw !== 'string' || !raw.trim() || raw.length > MAX_URL)
    return { ok: false, error: 'Paste the full webhook URL.' };
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return { ok: false, error: 'That is not a valid URL.' };
  }
  if (url.protocol !== 'https:') return { ok: false, error: 'The URL must start with https://.' };
  if (url.username || url.password)
    return { ok: false, error: 'The URL must not contain a username or password.' };
  const host = url.hostname.toLowerCase();

  if (kind === 'slack') {
    if (!SLACK_HOSTS.has(host) || !/^\/(services|triggers)\//.test(url.pathname)) {
      return {
        ok: false,
        error: 'A Slack incoming webhook URL starts with https://hooks.slack.com/services/.',
      };
    }
  } else if (kind === 'discord') {
    if (!DISCORD_HOSTS.has(host) || !url.pathname.startsWith('/api/webhooks/')) {
      return {
        ok: false,
        error: 'A Discord webhook URL starts with https://discord.com/api/webhooks/.',
      };
    }
  } else if (kind === 'teams') {
    if (host.endsWith('.webhook.office.com') || host === 'outlook.office.com') {
      return {
        ok: false,
        error:
          'Teams retired Office 365 connector webhooks in May 2026. Create one with the Workflows app instead.',
      };
    }
    if (!TEAMS_SUFFIXES.some((s) => host.endsWith(s))) {
      return {
        ok: false,
        error:
          'Use the webhook URL a Teams Workflows flow gives you (a logic.azure.com or powerplatform.com address).',
      };
    }
  } else {
    if (
      host === 'localhost' ||
      host.endsWith('.localhost') ||
      host.endsWith('.local') ||
      host.endsWith('.internal')
    ) {
      return { ok: false, error: 'The URL must be reachable on the public internet.' };
    }
    if (isIP(host.replace(/^\[|\]$/g, '')) && isPrivateAddress(host.replace(/^\[|\]$/g, ''))) {
      return { ok: false, error: 'The URL must be reachable on the public internet.' };
    }
  }
  return { ok: true, url };
}

type LookupCallback = (
  err: NodeJS.ErrnoException | null,
  address: string | LookupAddress[],
  family?: number,
) => void;

/**
 * A `lookup` for the socket that refuses private addresses. Runs at connect
 * time, which is what defeats DNS rebinding.
 */
export function safeLookup(
  resolve: typeof dnsLookup = dnsLookup,
): (hostname: string, options: { all?: boolean }, callback: LookupCallback) => void {
  return (hostname, options, callback) => {
    resolve(hostname, { all: true }, (err, addresses) => {
      if (err) return callback(err, []);
      const list = addresses as LookupAddress[];
      if (!list.length || list.some((a) => isPrivateAddress(a.address))) {
        const e = Object.assign(new Error(`${hostname} resolves to a private network address`), {
          code: 'EPRIVATE',
        });
        return callback(e, []);
      }
      if (options?.all) return callback(null, list);
      callback(null, list[0]!.address, list[0]!.family);
    });
  };
}

export interface PostOutcome {
  /** HTTP status, or 0 when no response arrived. */
  status: number;
  /** A short reason on failure: our words plus the provider's error code. */
  error: string | null;
  /** A network-layer code (`EPRIVATE`, `ETIMEDOUT`, …) when status is 0. */
  code?: string;
}

/** POST a pre-serialized body. Never throws. */
export function postJson(
  url: string,
  payload: string,
  headers: Record<string, string>,
  opts: { timeoutMs?: number; lookup?: ReturnType<typeof safeLookup> } = {},
): Promise<PostOutcome> {
  return new Promise((resolvePost) => {
    let settled = false;
    const done = (o: PostOutcome) => {
      if (!settled) {
        settled = true;
        resolvePost(o);
      }
    };
    let req: ReturnType<typeof https.request>;
    try {
      req = https.request(
        url,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'User-Agent': 'lurq-alerts',
            'Content-Length': Buffer.byteLength(payload),
            ...headers,
          },
          lookup: (opts.lookup ?? safeLookup()) as never,
          timeout: opts.timeoutMs ?? TIMEOUT_MS,
        },
        (res) => {
          let body = '';
          res.setEncoding('utf8');
          res.on('data', (chunk: string) => {
            if (body.length < MAX_RESPONSE) body += chunk;
          });
          res.on('end', () => {
            const status = res.statusCode ?? 0;
            done({
              status,
              error:
                status >= 200 && status < 300
                  ? null
                  : `HTTP ${status}${body ? `: ${body.slice(0, 120).replace(/\s+/g, ' ')}` : ''}`,
            });
          });
          res.on('error', () =>
            done({ status: res.statusCode ?? 0, error: 'response interrupted' }),
          );
        },
      );
    } catch (err) {
      done({
        status: 0,
        error: err instanceof Error ? err.message : 'request failed',
        code: 'EINVAL',
      });
      return;
    }
    req.on('timeout', () => {
      req.destroy(Object.assign(new Error('timed out'), { code: 'ETIMEDOUT' }));
    });
    req.on('error', (err: NodeJS.ErrnoException) => {
      done({
        status: 0,
        error:
          err.code === 'EPRIVATE' ? err.message : `could not connect (${err.code ?? err.message})`,
        code: err.code ?? 'ECONNECT',
      });
    });
    req.end(payload);
  });
}
