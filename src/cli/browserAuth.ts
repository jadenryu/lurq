/**
 * Get a key into the terminal without anyone copying and pasting one.
 *
 * The old setup flow: open the dashboard, sign in, click New key, select the
 * key, copy it, switch back to the terminal, paste, hope nothing mangled it.
 * Seven steps between "I want to try this" and "it works", six of them in a
 * different window from the one asking, and every one of them a place to give
 * up. It is the single longest stretch of the funnel with nothing happening in
 * it.
 *
 * This is the loopback flow every CLI that has solved this uses (`gh`, `vercel`,
 * `wrangler`): bind a one-shot HTTP server on a random localhost port, open the
 * browser at a page that knows the port, and let the page hand the key straight
 * back. The user signs in, and that is the whole interaction.
 *
 * WHAT MAKES IT SAFE ENOUGH.
 *   - The listener is bound to 127.0.0.1, so nothing off this machine can reach it.
 *   - The port is ephemeral and only the browser we just opened is told it.
 *   - A nonce goes out in the URL and has to come back with the key, so a stray
 *     local request cannot feed us a credential we did not ask for.
 *   - It answers exactly one request and closes, and it gives up after a
 *     deadline rather than sitting on a port forever.
 *
 * It is a best-effort optimisation, never a requirement: every failure path
 * here returns null and setup falls back to the paste prompt. SSH sessions,
 * headless boxes, locked-down browsers and firewalls all land there.
 */
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';

import { openInBrowser } from '../core/open';
import { API_KEY_PREFIX } from '../core/constants';

/** Where the handoff page lives. The apex redirects to www, which browsers follow. */
const WEB_ORIGIN = process.env.LURQ_WEB_URL ?? 'https://lurq.run';

/** How long to hold the port before giving up and asking for a paste. */
const DEADLINE_MS = 3 * 60_000;

/** Body cap. A key is ~50 bytes; anything near this is not one. */
const MAX_BODY = 4096;

function equal(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

async function readBody(req: IncomingMessage): Promise<string> {
  let out = '';
  for await (const chunk of req) {
    out += chunk;
    if (out.length > MAX_BODY) return '';
  }
  return out;
}

export interface BrowserAuthResult {
  key: string;
  /** Printed after the fact, so the user knows which key their machine now holds. */
  label: string | null;
}

/**
 * Open the browser and wait for it to hand back a key.
 *
 * `onUrl` receives the URL as soon as the port is known, so the caller can print
 * it: the browser may not have opened, and a URL nobody can see is a flow that
 * looks hung.
 */
export function keyViaBrowser(opts: {
  noOpen?: boolean;
  onUrl: (url: string) => void;
}): Promise<BrowserAuthResult | null> {
  return new Promise((resolve) => {
    const nonce = randomBytes(18).toString('base64url');
    let settled = false;

    const finish = (value: BrowserAuthResult | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      server.close();
      resolve(value);
    };

    const server = createServer((req: IncomingMessage, res: ServerResponse) => {
      // The page is on https://lurq.run and we are http://127.0.0.1, so every
      // request is cross-origin. Chrome additionally treats a public page
      // reaching localhost as a private-network request and preflights it, and
      // refuses without the matching header.
      res.setHeader('Access-Control-Allow-Origin', WEB_ORIGIN);
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
      res.setHeader('Access-Control-Allow-Private-Network', 'true');

      if (req.method === 'OPTIONS') {
        res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
        res.writeHead(204).end();
        return;
      }
      if (req.method !== 'POST') {
        res.writeHead(405).end();
        return;
      }

      void readBody(req).then((raw) => {
        let key = '';
        let label: string | null = null;
        try {
          const body = JSON.parse(raw) as { nonce?: unknown; key?: unknown; label?: unknown };
          if (typeof body.nonce === 'string' && equal(body.nonce, nonce)) {
            if (typeof body.key === 'string' && body.key.startsWith('lurq_')) key = body.key;
            if (typeof body.label === 'string') label = body.label;
          }
        } catch {
          /* not JSON; falls through to the reject below */
        }

        if (!key) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: false }));
          return;
        }

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true }));
        finish({ key, label });
      });
    });

    const timer = setTimeout(() => finish(null), DEADLINE_MS);
    // Never hold the process open on its own account: if something else has
    // already resolved setup, this must not keep node alive for three minutes.
    timer.unref?.();

    server.on('error', () => finish(null));
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as AddressInfo;
      const url = `${WEB_ORIGIN}/dashboard/cli?port=${port}&nonce=${encodeURIComponent(nonce)}`;
      opts.onUrl(url);
      if (!opts.noOpen) openInBrowser(url);
    });
  });
}

/** True for anything shaped like a key this CLI would accept. */
export function looksLikeKey(value: string): boolean {
  return value.startsWith('lurq_') || value.startsWith(API_KEY_PREFIX);
}
