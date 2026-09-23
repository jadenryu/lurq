/**
 * Private surface drift → repo alerts.
 *
 * `describeSurfaceBreak` is pure and tested without a database. The fan-out
 * needs real Postgres (the jsonb manifest join and the alert unique indexes are
 * the whole mechanism) and runs only when LURQ_TEST_DATABASE_URL points at a
 * migrated database.
 */
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('../src/core/analytics', () => ({ capture: vi.fn(), flush: vi.fn() }));
// The dispatch hop reaches GitHub; the alert rows are what this file is about.
vi.mock('../src/github/dispatch', () => ({ dispatchForAlerts: vi.fn(async () => undefined) }));

import { describeSurfaceBreak } from '../src/github/alerts';
import type { SurfaceDiff } from '../src/surface/diff';
import type { ExtractedSurface, SurfaceSymbol } from '../src/surface/types';

const sym = (path: string, over: Partial<SurfaceSymbol> = {}): SurfaceSymbol => ({
  path,
  kind: 'function',
  arity: 1,
  origin: 'local',
  deprecated: false,
  tier: 'shipped_js_ast',
  ...over,
});

const diff = (over: Partial<SurfaceDiff> = {}): SurfaceDiff => ({
  package: 'p',
  fromVersion: '1.0.0',
  toVersion: '2.0.0',
  tier: 'shipped_js_ast',
  removed: [],
  added: [],
  arityChanged: [],
  signatureChanged: [],
  typeOnlyRemoved: [],
  deprecated: [],
  renamed: [],
  ...over,
});

describe('describeSurfaceBreak', () => {
  it('says nothing when nothing broke', () => {
    expect(describeSurfaceBreak(diff({ added: [sym('brandNew')] }))).toBeNull();
  });

  it('never reads the arrays of a refused diff', () => {
    // A cross-tier or empty-surface diff has empty arrays by contract. Treating
    // that as "nothing changed" is right; treating it as a break would be a
    // false removal, which is the failure the verdict model exists to prevent.
    expect(
      describeSurfaceBreak(diff({ inconclusive: 'cross-tier comparison refused' })),
    ).toBeNull();
  });

  it('names removals', () => {
    const out = describeSurfaceBreak(diff({ removed: [sym('charge'), sym('refund')] }));
    expect(out).toContain('removed charge, refund');
  });

  it('leads with a proven rename and does not double-count it as a removal', () => {
    const out = describeSurfaceBreak(
      diff({ removed: [sym('parse')], renamed: [{ path: 'parse', to: ['parseCookie'] }] }),
    );
    expect(out).toContain('renamed parse → parseCookie');
    // The old name is gone, so it IS a removal — but reporting it twice would
    // say two things broke when one did.
    expect(out).not.toContain('removed parse');
  });

  it('separates type-only removals from runtime ones', () => {
    const out = describeSurfaceBreak(
      diff({ removed: [sym('run')], typeOnlyRemoved: [sym('Opts', { kind: 'type_only' })] }),
    );
    expect(out).toContain('removed run');
    expect(out).toContain('removed the type(s) Opts');
  });

  it('summarises past the naming cap', () => {
    const many = ['a', 'b', 'c', 'd', 'e', 'f', 'g'].map((n) => sym(n));
    expect(describeSurfaceBreak(diff({ removed: many }))).toContain('and 2 more');
  });
});

const TEST_DB = process.env.LURQ_TEST_DATABASE_URL;

function surfaceOf(pkg: string, version: string, names: string[]): ExtractedSurface {
  return {
    package: pkg,
    version,
    tier: 'shipped_js_ast',
    entry: 'index.js',
    symbols: names.map((n) => sym(n)),
    filesWalked: 1,
    externalReExports: [],
  };
}

describe.skipIf(!TEST_DB)('emitPrivateSurfaceAlerts against Postgres', () => {
  const run = randomUUID().slice(0, 8);
  const owner = `test_drift_${run}`;
  const pkg = `@acme/billing-${run}`;
  let db: import('../src/db/client').Database;
  let close: () => Promise<void>;
  let tenantId: number;
  let emit: typeof import('../src/github/alerts').emitPrivateSurfaceAlerts;
  let listAlerts: typeof import('../src/db/alerts').listAlerts;
  let diffSurfaces: typeof import('../src/surface/diff').diffSurfaces;

  const breaking = () =>
    diffSurfaces(
      surfaceOf(pkg, '1.0.0', ['charge', 'refund']),
      surfaceOf(pkg, '1.0.1', ['charge']),
    );

  beforeAll(async () => {
    process.env.DATABASE_URL = TEST_DB;
    const { createDb } = await import('../src/db/client');
    ({ db, close } = createDb());
    ({ emitPrivateSurfaceAlerts: emit } = await import('../src/github/alerts'));
    ({ listAlerts } = await import('../src/db/alerts'));
    ({ diffSurfaces } = await import('../src/surface/diff'));
    const { tenantIdFor } = await import('../src/db/graph');
    tenantId = await tenantIdFor(db, owner);

    const { repos } = await import('../src/db/schema');
    const { DEFAULT_REPO_POLICY } = await import('../src/github/types');
    await db.insert(repos).values({
      ownerId: owner,
      policy: DEFAULT_REPO_POLICY,
      installationId: 1,
      fullName: `${owner}/consumer`,
      defaultBranch: 'main',
      isPrivate: true,
      // How a monorepo actually declares an internal dependency.
      manifests: [{ path: 'package.json', deps: { [pkg]: 'workspace:*' } }],
    });
  });

  afterAll(async () => {
    await close?.();
  });

  it('alerts the repo that declares the package, naming what went', async () => {
    expect(await emit(db, owner, pkg, '1.0.1', breaking())).toBe(1);
    const [alert] = await listAlerts(db, owner);
    expect(alert?.packageName).toBe(pkg);
    expect(alert?.detail).toContain('removed refund');
  });

  it('treats workspace:* as definitively in range', async () => {
    const [alert] = await listAlerts(db, owner);
    // semver.validRange rejects `workspace:*`, so the shared draftAlert records
    // inRange=false. Left there, this alert is dropped from email, from the
    // agent notice and from every channel at its default threshold — for the
    // one dependency shape internal packages actually use.
    expect(alert?.inRange).toBe(true);
  });

  it('is a PATCH release, which the version-number path would never alert on', async () => {
    const [alert] = await listAlerts(db, owner);
    expect(alert?.toVersion).toBe('1.0.1');
  });

  it('does not alert twice for the same release', async () => {
    expect(await emit(db, owner, pkg, '1.0.1', breaking())).toBe(0);
  });

  it('does not alert when the publish removed nothing', async () => {
    const additive = diffSurfaces(
      surfaceOf(pkg, '1.0.1', ['charge']),
      surfaceOf(pkg, '1.1.0', ['charge', 'void']),
    );
    expect(await emit(db, owner, pkg, '1.1.0', additive)).toBe(0);
  });

  it('never alerts another account', async () => {
    const stranger = `${owner}_stranger`;
    expect(await emit(db, stranger, pkg, '2.0.0', breaking())).toBe(0);
    expect(await listAlerts(db, stranger)).toHaveLength(0);
  });
});
