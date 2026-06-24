/**
 * Operator-only API-key management for the hosted service (`lurq keys …`).
 * Requires DATABASE_URL — these commands run where the central DB lives, never on
 * a user's machine. New keys are printed in plaintext exactly once; only hashes
 * are stored, and list/JSON output never includes the hash.
 */
import { requireConfig } from '../core/config';
import { logger } from '../core/logger';
import { createKey, listKeys, revokeKey } from '../auth/apiKeys';
import { createDb } from '../db/client';
import { bold, dim, green, table } from './format';

const isoDay = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : '—');

export async function runKeysCreate(opts: { label?: string; tier?: string }): Promise<void> {
  requireConfig(['DATABASE_URL']);
  const { db, close } = createDb({ max: 1 });
  try {
    const { key, row } = await createKey(db, { label: opts.label, tier: opts.tier });
    console.log(bold('API key created.'));
    console.log(`\n  ${green(key)}\n`);
    console.log(dim('Store it now — it is shown only once and cannot be recovered.'));
    console.log(
      dim(`prefix=${row.prefix}  tier=${row.tier}${row.label ? `  label=${row.label}` : ''}`),
    );
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
