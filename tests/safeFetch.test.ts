/**
 * The SSRF guard in front of every probe. Policy checks run without a network;
 * redirect and size behaviour run against a real local server, with the policy
 * relaxed to allow exactly that server so the relaxation cannot hide a bug.
 */
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  createSafeFetch,
  publicHttpsOnly,
  ResponseTooLargeError,
  UnsafeUrlError,
  type UrlPolicy,
} from '../src/core/safeFetch';

describe('publicHttpsOnly', () => {
  const refuses = (u: string) => expect(() => publicHttpsOnly(new URL(u))).toThrow(UnsafeUrlError);

  it('accepts a public https URL', () => {
    expect(() => publicHttpsOnly(new URL('https://mcp.example.com/mcp'))).not.toThrow();
  });

  it('refuses plain http, credentials, local names and private literals', () => {
    refuses('http://mcp.example.com/mcp');
    refuses('https://user:pass@mcp.example.com/mcp');
    refuses('https://localhost/mcp');
    refuses('https://printer.local/');
    refuses('https://db.railway.internal/');
    refuses('https://127.0.0.1/');
    refuses('https://10.0.0.8/');
    refuses('https://169.254.169.254/latest/meta-data');
    refuses('https://[::1]/');
    refuses('https://[::ffff:a9fe:a9fe]/');
  });
});

describe('createSafeFetch against a local server', () => {
  let server: Server;
  let base: string;
  const seen: { method: string; url: string; body: string }[] = [];

  beforeAll(async () => {
    server = createServer((req: IncomingMessage, res: ServerResponse) => {
      let body = '';
      req.on('data', (c) => (body += c));
      req.on('end', () => {
        seen.push({ method: req.method!, url: req.url!, body });
        const at = (path: string) => `${base}${path}`;
        switch (req.url) {
          case '/ok':
            res.writeHead(200, { 'content-type': 'application/json' }).end('{"ok":true}');
            break;
          case '/307':
            res.writeHead(307, { location: at('/echo') }).end();
            break;
          case '/303':
            res.writeHead(303, { location: at('/echo') }).end();
            break;
          case '/echo':
            res.writeHead(200).end(`${req.method}:${body}`);
            break;
          case '/to-metadata':
            res.writeHead(302, { location: 'http://169.254.169.254/latest/meta-data' }).end();
            break;
          case '/loop':
            res.writeHead(302, { location: at('/loop') }).end();
            break;
          case '/big':
            res.writeHead(200).end('x'.repeat(10_000));
            break;
          default:
            res.writeHead(404).end();
        }
      });
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(() => new Promise<void>((r) => server.close(() => r())));

  // Allows the test server and nothing else; every other address still gets the
  // production policy, which is what makes the redirect test meaningful.
  const onlyTestServer: UrlPolicy = (url) => {
    if (url.origin === base) return;
    publicHttpsOnly(url);
  };
  const localLookup = ((host: string, options: { all?: boolean }, cb: (...a: unknown[]) => void) =>
    options?.all
      ? cb(null, [{ address: '127.0.0.1', family: 4 }])
      : cb(null, '127.0.0.1', 4)) as never;
  const fetchLocal = (over = {}) =>
    createSafeFetch({ policy: onlyTestServer, lookup: localLookup, ...over });

  it('returns a real Response with the body intact', async () => {
    const res = await fetchLocal()(`${base}/ok`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });

  it('refuses a disallowed URL before any request is made', async () => {
    const before = seen.length;
    await expect(createSafeFetch()(`${base}/ok`)).rejects.toThrow(UnsafeUrlError);
    expect(seen.length).toBe(before);
  });

  it('keeps method and body across a 307', async () => {
    const res = await fetchLocal()(`${base}/307`, { method: 'POST', body: '{"id":1}' });
    expect(await res.text()).toBe('POST:{"id":1}');
  });

  it('turns a POST into a GET across a 303', async () => {
    const res = await fetchLocal()(`${base}/303`, { method: 'POST', body: '{"id":1}' });
    expect(await res.text()).toBe('GET:');
  });

  it('re-checks every redirect hop, so a redirect cannot reach the metadata service', async () => {
    await expect(fetchLocal()(`${base}/to-metadata`)).rejects.toThrow(/https|private/);
  });

  it('stops after the redirect limit', async () => {
    await expect(fetchLocal({ maxRedirects: 2 })(`${base}/loop`)).rejects.toThrow(
      /more than 2 redirects/,
    );
  });

  it('errors instead of buffering a body past the cap', async () => {
    const res = await fetchLocal({ maxBytes: 1_000 })(`${base}/big`);
    await expect(res.text()).rejects.toThrow(ResponseTooLargeError);
  });

  it('refuses at connect time when DNS answers with a private address', async () => {
    const rebinding = ((host: string, options: { all?: boolean }, cb: (...a: unknown[]) => void) =>
      cb(
        Object.assign(new Error(`${host} resolves to a private network address`), {
          code: 'EPRIVATE',
        }),
        [],
      )) as never;
    const f = createSafeFetch({ policy: () => {}, lookup: rebinding });
    await expect(f('https://looks-public.example.com/')).rejects.toThrow();
  });
});
