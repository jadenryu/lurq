/**
 * Operator-only API-key management for the hosted service (`lurq keys …`).
 * Requires DATABASE_URL — these commands run where the central DB lives, never on
 * a user's machine. New keys are printed in plaintext exactly once; only hashes
 * are stored, and list/JSON output never includes the hash.
 */
import { requireConfig } from '../core/config';
import { logger } from '../core/logger';
import { createKey, listKeys, revokeKey, rotateKey } from '../auth/apiKeys';
import type { ApiKeyRow } from '../db/schema';
import { createDb } from '../db/client';
import { bold, dim, green, table } from './format';

const isoDay = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : '—');

/** Block until the operator presses Enter (resolves immediately if not a TTY). */
function waitForEnter(prompt: string): Promise<void> {
  return new Promise((resolve) => {
    process.stdout.write(prompt);
    process.stdin.resume();
    process.stdin.once('data', () => {
      process.stdin.pause();
      resolve();
    });
  });
}

/**
 * Present a freshly-issued plaintext key exactly once. In JSON mode it prints a
 * single line (plus any `extraJson`) for scripts. Interactively it shows the key,
 * waits for the operator to copy it, then wipes it from the terminal (screen +
 * scroll-back). Shared by `keys create` and `keys rotate`.
 */
async function presentNewKey(
  key: string,
  row: ApiKeyRow,
  opts: { json?: boolean; header?: string; extraJson?: Record<string, unknown> },
): Promise<void> {
  if (opts.json) {
    console.log(
      JSON.stringify({ key, prefix: row.prefix, tier: row.tier, label: row.label, ...opts.extraJson }),
    );
    return;
  }

  const meta = `prefix=${row.prefix}  tier=${row.tier}${row.label ? `  label=${row.label}` : ''}`;
  const block = [bold(opts.header ?? 'API key created.'), '', `  ${green(key)}`, '', dim(meta)];

  console.log(block.join('\n'));

  if (process.stdout.isTTY && process.stdin.isTTY) {
    // Show the key, then wipe it from the terminal (screen + scrollback) once
    // the operator confirms they've copied it — so it doesn't linger on screen
    // or in scroll-back history.
    await waitForEnter(dim('Copy it now, then press Enter to erase it from the terminal… '));
    // Move to the top of the printed block (block lines + the prompt line the
    // Enter advanced past), clear to end of screen, and clear scroll-back.
    process.stdout.write(`\x1b[${block.length + 1}F\x1b[0J\x1b[3J`);
    console.log(
      dim(`New key (prefix ${row.prefix}) erased from the terminal. ` +
        `It is stored only as a hash and cannot be recovered, so make sure you saved it.`),
    );
  } else {
    // Non-TTY (piped, or over a non-interactive SSH exec): can't erase, so just
    // warn. Operator is responsible for clearing their buffer.
    console.log(dim('Store it now — shown only once, stored hashed, cannot be recovered.'));
  }
}

export async function runKeysCreate(opts: {
  label?: string;
  tier?: string;
  json?: boolean;
}): Promise<void> {
  requireConfig(['DATABASE_URL']);
  const { db, close } = createDb({ max: 1 });
  try {
    const { key, row } = await createKey(db, { label: opts.label, tier: opts.tier });
    await presentNewKey(key, row, opts);
  } finally {
    await close();
  }
}

export async function runKeysRotate(
  prefixOrId: string,
  opts: { json?: boolean },
): Promise<void> {
  requireConfig(['DATABASE_URL']);
  const { db, close } = createDb({ max: 1 });
  try {
    const result = await rotateKey(db, prefixOrId);
    if (!result) {
      logger.warn(`No active key matched "${prefixOrId}".`);
      process.exitCode = 1;
      return;
    }
    await presentNewKey(result.key, result.row, {
      json: opts.json,
      header: `API key rotated — replaces ${result.previous.prefix} (now revoked).`,
      extraJson: { replaced: result.previous.prefix },
    });
  } finally {
    await close();
  }
}

export async function runKeysList(opts: { json?: boolean }): Promise<void> {
  requireConfig(['DATABASE_URL']);
  const { db, close } = createDb({ max: 1 });
  try {
    const rows = await listKeys(db);
    if (opts.json) {
      // Deliberately omit keyHash from machine output.
      console.log(
        JSON.stringify(
          rows.map((r) => ({
            id: r.id,
            prefix: r.prefix,
            label: r.label,
            tier: r.tier,
            ownerId: r.ownerId,
            createdAt: r.createdAt,
            lastUsedAt: r.lastUsedAt,
            revokedAt: r.revokedAt,
          })),
          null,
          2,
        ),
      );
      return;
    }
    if (rows.length === 0) {
      console.log('No API keys yet. Create one with `lurq keys create --label <name>`.');
      return;
    }
    console.log(
      table(
        ['prefix', 'label', 'tier', 'created', 'last used', 'status'],
        rows.map((r) => [
          r.prefix,
          r.label ?? '—',
          r.tier,
          isoDay(r.createdAt),
          isoDay(r.lastUsedAt),
          r.revokedAt ? 'revoked' : 'active',
        ]),
      ),
    );
  } finally {
    await close();
  }
}

export async function runKeysRevoke(prefixOrId: string): Promise<void> {
  requireConfig(['DATABASE_URL']);
  const { db, close } = createDb({ max: 1 });
  try {
    const n = await revokeKey(db, prefixOrId);
    if (n === 0) {
      logger.warn(`No active key matched "${prefixOrId}".`);
      process.exitCode = 1;
      return;
    }
    console.log(`Revoked ${n} key(s) matching "${prefixOrId}".`);
  } finally {
    await close();
  }
}
