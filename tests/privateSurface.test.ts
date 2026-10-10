/**
 * Private surfaces: tenant isolation.
 *
 * This is the only property worth a test here, and it is worth it twice over.
 * A leak is a customer's internal API handed to a stranger; a false miss is
 * lurq telling an agent a symbol does not exist when it does, which is the one
 * failure the verdict model exists to prevent.
 *
 * Needs real Postgres semantics (the unique index on (canonical_key, tenant_id)
 * is what allows one name to exist once per tenant), so it runs only when
 * LURQ_TEST_DATABASE_URL points at a migrated database:
 * `docker compose up -d`, migrate, then set it.
 */
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { ExtractedSurface } from '../src/surface/types';

const TEST_DB = process.env.LURQ_TEST_DATABASE_URL;

function surfaceOf(pkg: string, version: string, names: string[]): ExtractedSurface {
  return {
    package: pkg,
    version,
    tier: 'shipped_js_ast',
    entry: 'index.js',
    symbols: names.map((path) => ({
      path,
      kind: 'function' as const,
      arity: 1,
      origin: 'local' as const,
      deprecated: false,
      tier: 'shipped_js_ast' as const,
    })),
    filesWalked: 1,
    externalReExports: [],
  };
}

describe.skipIf(!TEST_DB)('private surfaces are visible to their tenant only', () => {
  const run = randomUUID().slice(0, 8);
  const pkg = `@acme/billing-${run}`;
  let db: import('../src/db/client').Database;
  let close: () => Promise<void>;
  let tenantA: number;
  let tenantB: number;
  let loadStored: typeof import('../src/mcp/surfaceHandlers').loadStored;

  beforeAll(async () => {
    process.env.DATABASE_URL = TEST_DB;
    const { createDb } = await import('../src/db/client');
    ({ db, close } = createDb());
    const { tenantIdFor } = await import('../src/db/graph');
    const { storeSurface } = await import('../src/db/surface');
    ({ loadStored } = await import('../src/mcp/surfaceHandlers'));

    tenantA = await tenantIdFor(db, `test_surface_${run}_a`);
    tenantB = await tenantIdFor(db, `test_surface_${run}_b`);

    // The same package name, three graphs: A's, B's, and public.
    await storeSurface(db, surfaceOf(pkg, '1.0.0', ['charge', 'refund']), {
      extractorVersion: '2',
      tenantId: tenantA,
      oracleId: 'surface.author',
    });
    await storeSurface(db, surfaceOf(pkg, '1.0.0', ['onlyB']), {
      extractorVersion: '2',
      tenantId: tenantB,
      oracleId: 'surface.author',
    });
  });

  afterAll(async () => {
    await close?.();
  });

  it('mints a distinct, non-public tenant per owner', () => {
    expect(tenantA).toBeGreaterThan(0);
    expect(tenantB).toBeGreaterThan(0);
    expect(tenantA).not.toBe(tenantB);
  });

  it('is the same tenant on a second resolution of the same owner', async () => {
    const { tenantIdFor } = await import('../src/db/graph');
    expect(await tenantIdFor(db, `test_surface_${run}_a`)).toBe(tenantA);
  });

  it('answers the owning tenant with its own symbols', async () => {
    const stored = await loadStored(db, pkg, '1.0.0', tenantA);
    expect(stored?.private).toBe(true);
    expect(stored?.rows.map((r) => r.path).sort()).toEqual(['charge', 'refund']);
  });

  it('never leaks one tenant to another', async () => {
    const stored = await loadStored(db, pkg, '1.0.0', tenantB);
    expect(stored?.rows.map((r) => r.path)).toEqual(['onlyB']);
  });

  it('is invisible to the public graph', async () => {
    expect(await loadStored(db, pkg, '1.0.0', 0)).toBeNull();
  });

  it('falls back to the public graph for names the tenant has not published', async () => {
    const publicOnly = `public-only-${run}`;
    const { storeSurface } = await import('../src/db/surface');
    await storeSurface(db, surfaceOf(publicOnly, '2.0.0', ['fromPublic']), {
      extractorVersion: '2',
    });

    // A private tenant must not lose the public index — that is what keeps
    // every other answer working once an account publishes anything at all.
    const stored = await loadStored(db, publicOnly, '2.0.0', tenantA);
    expect(stored?.private).toBe(false);
    expect(stored?.rows.map((r) => r.path)).toEqual(['fromPublic']);
  });

  it('prefers the tenant over public when both carry the name, with no version pinned', async () => {
    const forked = `forked-${run}`;
    const { storeSurface } = await import('../src/db/surface');

    // Order matters: the tenant's row is written FIRST so the public one is the
    // more recent observation. The unpinned path sorts by observation time, so
    // recency alone would answer with the public package — tenant precedence
    // has to beat it, or a team running a fork is told about the package they
    // are not running. Written the other way round this test passes with or
    // without the fix, and proves nothing.
    await storeSurface(db, surfaceOf(forked, '1.0.0', ['ourShape']), {
      extractorVersion: '2',
      tenantId: tenantA,
      oracleId: 'surface.author',
    });
    await storeSurface(db, surfaceOf(forked, '1.0.0', ['publicShape']), {
      extractorVersion: '2',
    });
    const stored = await loadStored(db, forked, null, tenantA);
    expect(stored?.private).toBe(true);
    expect(stored?.rows.map((r) => r.path)).toEqual(['ourShape']);
  });
});
