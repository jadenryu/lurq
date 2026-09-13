/**
 * The email pass against real Postgres: what gets sent, what never gets sent
 * twice, what waits, and what is retried. Runs when LURQ_TEST_DATABASE_URL points
 * at a migrated database.
 */
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { OutgoingEmail } from '../src/notify/email';
import { SendError } from '../src/notify/email';

const TEST_DB = process.env.LURQ_TEST_DATABASE_URL;
const WEB = 'https://lurq.test';

describe.skipIf(!TEST_DB)('runNotifications against Postgres', () => {
  const run = randomUUID().slice(0, 8);
  const owner = (n: string) => `user_notify${run}${n}`;
  let db: import('../src/db/client').Database;
  let close: () => Promise<void>;
  let schema: typeof import('../src/db/schema');
  let store: typeof import('../src/db/notifications');
  let runNotifications: typeof import('../src/notify/run').runNotifications;
  let sent: OutgoingEmail[];
  let repoId = 900_000 + Math.floor(Math.random() * 90_000);

  beforeAll(async () => {
    process.env.DATABASE_URL = TEST_DB;
    const { createDb } = await import('../src/db/client');
    schema = await import('../src/db/schema');
    store = await import('../src/db/notifications');
    ({ runNotifications } = await import('../src/notify/run'));
    const h = createDb({ max: 4 });
    db = h.db;
    close = h.close;
  });

  afterAll(async () => {
    // Local test database only: remove exactly this run's rows, children first.
    const { sql } = await import('drizzle-orm');
    const like = `user_notify${run}%`;
    await db.execute(sql`delete from notification_items where owner_id like ${like}`);
    await db.execute(sql`delete from notification_deliveries where owner_id like ${like}`);
    await db.execute(sql`delete from notification_preferences where owner_id like ${like}`);
    await db.execute(sql`delete from repo_alerts where owner_id like ${like}`);
    await db.execute(sql`delete from mcp_change_events where owner_id like ${like}`);
    await db.execute(sql`delete from mcp_deployments where owner_id like ${like}`);
    await close();
  });

  beforeEach(() => {
    sent = [];
  });

  const deps = (over: Record<string, unknown> = {}) => ({
    db,
    webUrl: WEB,
    now: new Date(),
    send: vi.fn(async (m: OutgoingEmail) => {
      sent.push(m);
      return { id: `em_${sent.length}` };
    }),
    lookupEmail: vi.fn(async (o: string) => `${o}@example.com`),
    ...over,
  });

  async function alert(ownerId: string, inRange: boolean, hoursAgo = 1) {
    const [row] = await db
      .insert(schema.repoAlerts)
      .values({
        ownerId,
        repoId: repoId++,
        repoFullName: 'acme/api',
        packageName: `pkg-${randomUUID().slice(0, 6)}`,
        range: '>=18',
        fromVersion: '18.5.0',
        toVersion: '19.0.0',
        inRange,
        createdAt: new Date(Date.now() - hoursAgo * 3_600_000),
      })
      .returning();
    return row!;
  }

  async function mcpEvent(ownerId: string, diff: Record<string, unknown>) {
    const [dep] = await db
      .insert(schema.mcpDeployments)
      .values({ ownerId, serverKey: `local:${randomUUID()}`, configFingerprint: '0123456789abcdef', alias: 'notes', registry: 'local', transport: 'stdio', lastStatus: 'ok' })
      .returning();
    const [ev] = await db
      .insert(schema.mcpChangeEvents)
      .values({
        deploymentId: dep!.id,
        ownerId,
        fromHash: randomUUID(),
        toHash: randomUUID(),
        severity: 'critical',
        summary: 'rewrote',
        diff: { rugPull: [], contract: { annotationFlips: [] }, ...diff } as never,
      })
      .returning();
    return ev!;
  }

  const mine = (o: string) => sent.filter((m) => m.to === `${o}@example.com`);

  it('batches an account’s urgent items into one email, and never sends them twice', async () => {
    const o = owner('a');
    await alert(o, true);
    await alert(o, false); // pinned behind: not urgent
    await alert(o, true, 30); // older than a day: not considered
    await mcpEvent(o, { rugPull: ['add_note'] });
    await mcpEvent(o, {}); // a change, but not an urgent one

    await runNotifications(deps());
    const emails = mine(o);
    expect(emails).toHaveLength(1);
    expect(emails[0]!.subject).toBe('lurq: 2 urgent changes to what your agents depend on');
    // Rug pull is listed before the release.
    expect(emails[0]!.text.indexOf('now instructs your agent')).toBeLessThan(emails[0]!.text.indexOf('will install on its own in'));
    expect(emails[0]!.headers?.['List-Unsubscribe-Post']).toBe('List-Unsubscribe=One-Click');

    sent = [];
    await runNotifications(deps());
    expect(mine(o)).toEqual([]);
  });

  it('sends nothing to an account that turned urgent email off', async () => {
    const o = owner('off');
    await store.setPreferences(db, o, { urgentEmail: false });
    await alert(o, true);
    await runNotifications(deps());
    expect(mine(o)).toEqual([]);
  });

  it('holds items back past the daily cap instead of flooding', async () => {
    const o = owner('cap');
    await alert(o, true);
    await runNotifications(deps({ maxUrgentPerDay: 1 }));
    expect(mine(o)).toHaveLength(1);
    await alert(o, true);
    sent = [];
    const s = await runNotifications(deps({ maxUrgentPerDay: 1 }));
    expect(mine(o)).toEqual([]);
    expect(s.deferred).toBeGreaterThanOrEqual(1);
  });

  it('retries a transient failure with the same idempotency key, and gives up on a permanent one', async () => {
    const flaky = owner('flaky');
    const dead = owner('dead');
    await alert(flaky, true);
    await alert(dead, true);
    const send = vi.fn(async (m: OutgoingEmail) => {
      if (m.to.startsWith(dead)) throw new SendError('resend 422: invalid_to', false, 422);
      if (send.mock.calls.filter((c) => c[0].to === m.to).length === 1) throw new SendError('resend 503', true, 503);
      sent.push(m);
      return { id: 'em_ok' };
    });

    await runNotifications(deps({ send }));
    expect(mine(flaky)).toEqual([]);
    await runNotifications(deps({ send }));
    expect(mine(flaky)).toHaveLength(1);

    const keys = send.mock.calls.filter((c) => c[0].to.startsWith(flaky)).map((c) => c[0].idempotencyKey);
    expect(new Set(keys).size).toBe(1);
    expect(send.mock.calls.filter((c) => c[0].to.startsWith(dead))).toHaveLength(1);
  });

  it('never retries into an empty email when the alert is gone', async () => {
    const o = owner('gone');
    const a = await alert(o, true);
    const send = vi.fn(async (m: OutgoingEmail) => {
      if (m.to.startsWith(o)) throw new SendError('resend 503', true, 503);
      return { id: 'em_other' };
    });
    await runNotifications(deps({ send }));
    // The repo is disconnected before the retry, which removes its alerts.
    const { eq } = await import('drizzle-orm');
    await db.delete(schema.repoAlerts).where(eq(schema.repoAlerts.id, a.id));

    const retrySend = vi.fn(async (m: OutgoingEmail) => ({ id: m.to }));
    await runNotifications(deps({ send: retrySend }));
    expect(retrySend.mock.calls.filter((c) => c[0].to.startsWith(o))).toEqual([]);
  });

  it('skips, and does not retry, an account with no verified email', async () => {
    const o = owner('noemail');
    await alert(o, true);
    const lookupEmail = vi.fn(async (x: string) => (x === o ? null : `${x}@example.com`));
    await runNotifications(deps({ lookupEmail }));
    await runNotifications(deps({ lookupEmail }));
    expect(mine(o)).toEqual([]);
    expect(lookupEmail.mock.calls.filter((c) => c[0] === o)).toHaveLength(1);
  });

  it('sends the weekly summary only to subscribers, only on Monday, once a week', async () => {
    const sub = owner('digest');
    const notSub = owner('nodigest');
    await store.setPreferences(db, sub, { weeklyDigest: true });
    await mcpEvent(sub, {});
    await mcpEvent(notSub, {});
    const monday = new Date('2099-09-14T14:00:00Z'); // future, so the urgent pass finds nothing
    const tuesday = new Date('2099-09-15T14:00:00Z');

    await runNotifications(deps({ now: tuesday }));
    expect(mine(sub)).toEqual([]);

    await runNotifications(deps({ now: monday }));
    expect(mine(sub)).toHaveLength(1);
    expect(mine(sub)[0]!.subject).toMatch(/^lurq weekly:/);
    expect(mine(notSub)).toEqual([]);

    sent = [];
    await runNotifications(deps({ now: new Date('2099-09-14T18:00:00Z') }));
    expect(mine(sub)).toEqual([]);
  });

  it('turns one kind off by token, and ignores a token nobody holds', async () => {
    const o = owner('unsub');
    const prefs = await store.setPreferences(db, o, { weeklyDigest: true });
    expect(await store.unsubscribeByToken(db, prefs.unsubscribeToken, 'digest')).toBe(true);
    const after = await store.getOrCreatePreferences(db, o);
    expect(after).toMatchObject({ weeklyDigest: false, urgentEmail: true });
    expect(await store.unsubscribeByToken(db, 'nobody-holds-this-token-000', 'urgent')).toBe(false);
  });
});
