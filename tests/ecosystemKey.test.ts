import { describe, it, expect } from 'vitest';
import { getTableConfig } from 'drizzle-orm/pg-core';
import { packages } from '../src/db/schema';
import { ECOSYSTEMS, DEFAULT_ECOSYSTEM } from '../src/core/types';

/**
 * `packages` is keyed by (ecosystem, name) because `requests`, `redis`, `click`
 * and `attrs` are all real, unrelated packages on BOTH npm and PyPI.
 *
 * The failure this guards is silent and production-only: Postgres rejects an
 * ON CONFLICT whose target doesn't match a unique index, so `upsertPackage` and
 * the index have to change together. A schema edit that drops one without the
 * other typechecks, passes every other test, and then kills ingestion on the
 * next deploy — `db migrate` runs in the serve service's start command.
 */
describe('packages composite key', () => {
  const config = getTableConfig(packages);

  it('has a unique index on (ecosystem, name)', () => {
    const composite = config.indexes.find((i) => i.config.name === 'packages_ecosystem_name_idx');
    expect(composite, 'packages_ecosystem_name_idx is missing').toBeDefined();
    expect(composite!.config.unique).toBe(true);
    expect(composite!.config.columns.map((c) => (c as { name: string }).name)).toEqual([
      'ecosystem',
      'name',
    ]);
  });

  it('does NOT carry a standalone unique on name', () => {
    // A global unique on `name` is exactly the bug: whichever registry synced
    // last would overwrite the other's scores, advisories and version timeline.
    const nameCol = config.columns.find((c) => c.name === 'name');
    expect(nameCol?.isUnique).toBeFalsy();
  });

  it('defaults the ecosystem column so existing npm rows need no backfill', () => {
    const eco = config.columns.find((c) => c.name === 'ecosystem');
    expect(eco?.notNull).toBe(true);
    expect(eco?.default).toBe(DEFAULT_ECOSYSTEM);
  });

  it('knows both registries', () => {
    expect([...ECOSYSTEMS]).toEqual(['npm', 'pypi']);
    expect(DEFAULT_ECOSYSTEM).toBe('npm');
  });
});
