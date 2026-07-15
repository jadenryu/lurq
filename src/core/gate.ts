/**
 * Pre-launch access gate.
 *
 * While lurq is in private preview, anyone may `npm install lurqrun`, but only
 * the owner may run commands — everyone else gets a branded placeholder. The
 * owner proves identity by exporting `LURQ_OWNER_KEY` in their shell to the
 * secret whose SHA-256 is baked into `OWNER_HASH` below. The published bundle
 * carries only the hash, never the secret, so inspecting the source reveals
 * nothing usable.
 *
 * To lift the gate at public launch, flip `PRE_LAUNCH` to false (or delete the
 * `enforceGate()` call in bin/lurq.ts). The owner bypass keeps working either
 * way, so nothing else needs to change.
 */
import { createHash, timingSafeEqual } from 'node:crypto';

import { PACKAGE_NAME } from './constants';

/** Master switch. Set to false to open lurq to everyone at launch. */
const PRE_LAUNCH = false;

/**
 * SHA-256 of the owner secret. Regenerate after choosing a new secret with:
 *   node -e "console.log(require('node:crypto').createHash('sha256').update(process.argv[1]).digest('hex'))" <secret>
 * and paste the result here. Keep the plaintext only in your shell env.
 */
const OWNER_HASH = '9675c37e56783e747e4a89ee3919d95d1364f2e5dd0f14501b0f878f8cc3682b';

/**
 * Top-level commands that bypass the gate even for non-owners:
 *  - `-v/--version/-h/--help/help` — harmless, expected by npm users.
 *  - `serve`/`serve-http` — the MCP transports. The gate must NEVER write to the
 *    stdio JSON-RPC channel (`serve`), and the hosted server must boot without
 *    depending on the owner key (`serve-http`).
 *  - `sync`/`discover`/`rescore`/`db`/`keys` — operator/infra commands that all
 *    require DATABASE_URL, which a public installer never has. Gating them adds no
 *    protection (a keyless user can't run them anyway) while risking the owner's
 *    own deploy. The gate's real job is the user-facing commands (recommend,
 *    evaluate, compare, verify, plan, install, install-skill, weights).
 */
const ALLOWED = new Set([
  '-v', '--version', '-h', '--help', 'help',
  'serve', 'serve-http',
  'sync', 'discover', 'rescore', 'db', 'keys',
]);

/** True when the caller has proven they are the owner via `LURQ_OWNER_KEY`. */
export function isOwner(): boolean {
  const key = process.env.LURQ_OWNER_KEY;
  if (!key) return false;
  const got = createHash('sha256').update(key).digest();
  const want = Buffer.from(OWNER_HASH, 'hex');
  // Equal-length buffers (both 32 bytes); timingSafeEqual guards against a
  // timing oracle on the comparison.
  return got.length === want.length && timingSafeEqual(got, want);
}

/**
 * Enforce the gate before any command runs. Returns normally when the caller is
 * the owner, the gate is lifted, or the invocation is a top-level help/version
 * query. Otherwise prints the placeholder and exits cleanly (code 0 — installing
 * early is not an error).
 */
export function enforceGate(argv: string[]): void {
  if (!PRE_LAUNCH || isOwner()) return;
  if (argv[0] && ALLOWED.has(argv[0])) return;

  printPlaceholder();
  process.exit(0);
}

function printPlaceholder(): void {
  const tty = process.stdout.isTTY;
  const bold = (s: string) => (tty ? `\x1b[1m${s}\x1b[0m` : s);
  const dim = (s: string) => (tty ? `\x1b[2m${s}\x1b[0m` : s);
  const accent = (s: string) => (tty ? `\x1b[38;5;213m${s}\x1b[0m` : s);

  process.stdout.write(
    [
      '',
      `  ${bold('lurq')} ${dim('— evidence-scored package index for AI coding agents')}`,
      '',
      `  ${accent('◆ private preview')}`,
      '',
      `  lurq isn't open to the public yet — thanks for installing early.`,
      `  Join the waitlist and watch the demo at ${bold('https://lurq.run')}`,
      '',
      dim(`  You'll be able to connect Claude Code, Cursor, and other agents`),
      dim(`  the moment we open the gate.`),
      '',
      dim(`  (${PACKAGE_NAME} is installed and ready — no further action needed.)`),
      '',
      '',
    ].join('\n'),
  );
}
