/**
 * The channel pass against real Postgres, with posting faked. Runs when
 * LURQ_TEST_DATABASE_URL points at a migrated database.
 */
import { randomBytes, randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { Formatted } from '../src/notify/channels';
import type { PostOutcome } from '../src/notify/safeHttp';

const TEST_DB = process.env.LURQ_TEST_DATABASE_URL;
const key = randomBytes(32);

describe.skipIf(!TEST_DB)('runChannels against Postgres', () => {
  const run = randomUUID().slice(0, 8);
  const owner = (n: string) => `user_chan${run}${n}`;
  let db: import('../src/db/client').Database;
  let close: () => Promise<void>;
  let schema: typeof import('../src/db/schema');
  let store: typeof import('../src/db/notifications');
  let runChannels: typeof import('../src/notify/channelRun').runChannels;
  let seal: typeof import('../src/core/secretBox').seal;
  let repoId = 800_000 + Math.floor(Math.random() * 90_000);

  beforeAll(async () => {
    process.env.DATABASE_URL = TEST_DB;
    const { createDb } = await import('../src/db/client');
    schema = await import('../src/db/schema');
    store = await import('../src/db/notifications');
    ({ runChannels } = await import('../src/notify/channelRun'));
    ({ seal } = await import('../src/core/secretBox'));
    const h = createDb({ max: 4 });
    db = h.db;
    close = h.close;
  });

  afterAll(async () => {
    const { sql } = await import('drizzle-orm');
    const like = `user_chan${run}%`;
    await db.execute(sql`delete from notification_items where owner_id like ${like}`);
    await db.execute(sql`delete from notification_deliveries where owner_id like ${like}`);
    await db.execute(sql`delete from notification_channels where owner_id like ${like}`);
    await db.execute(sql`delete from repo_alerts where owner_id like ${like}`);
    await close();
  });

  async function channel(ownerId: string, over: Record<string, unknown> = {}) {
    return store.insertChannel(db, {
      ownerId,
      kind: 'slack',
      urlCiphertext: seal(`https://hooks.slack.com/services/T/B/${randomUUID()}`, key, ownerId),
      urlHint: 'hooks.slack.com/…abcd',
      minSeverity: 'moderate',
      ...over,
    });
  }

  async function alert(ownerId: string, inRange: boolean) {
    await db.insert(schema.repoAlerts).values({
      ownerId,
      repoId: repoId++,
      repoFullName: 'acme/api',
      packageName: `pkg-${randomUUID().slice(0, 6)}`,
      range: inRange ? '>=18' : '^18',
      fromVersion: '18.0.0',
      toVersion: '19.0.0',
      inRange,
    });
  }

  const deps = (post: (url: string, m: Formatted) => Promise<PostOutcome>, allowed = true) => ({
    db,
    webUrl: 'https://lurq.test',
    secretsKey: key,
    post: vi.fn(post),
    allowed: async () => allowed,
  });
  const ok = async () => ({ status: 200, error: null });

  it('posts each channel’s items once, filtered by its threshold', async () => {
    const o = owner('a');
    const all = await channel(o, { minSeverity: 'moderate' });
    const highOnly = await channel(o, { minSeverity: 'high' });
    await alert(o, true); // high
    await alert(o, false); // moderate

    const d = deps(ok);
    await runChannels(d);
    const bodies = d.post.mock.calls.map((c) => JSON.parse(c[1].payload));
    expect(d.post).toHaveBeenCalledTimes(2);
    const sections = (b: { blocks: { type: string }[] }) =>
      b.blocks.filter((x) => x.type === 'section').length;
    expect(bodies.map(sections).sort()).toEqual([1, 2]);

    const again = deps(ok);
    await runChannels(again);
    expect(again.post).not.toHaveBeenCalled();
    expect((await store.getChannel(db, o, all.id))!.lastDeliveredAt).not.toBeNull();
    expect((await store.getChannel(db, o, highOnly.id))!.consecutiveFailures).toBe(0);
  });

  it('switches a channel off when its destination is gone, with the reason', async () => {
    const o = owner('gone');
    const c = await channel(o);
    await alert(o, true);
    await runChannels(deps(async () => ({ status: 404, error: 'HTTP 404: no_service' })));
    const after = (await store.getChannel(db, o, c.id))!;
    expect(after.enabled).toBe(false);
    expect(after.disabledReason).toMatch(/no longer exists/);
  });

  it('retries a transient failure on the next run', async () => {
    const o = owner('flaky');
    const c = await channel(o);
    await alert(o, true);
    await runChannels(deps(async () => ({ status: 503, error: 'HTTP 503' })));
    expect((await store.getChannel(db, o, c.id))!.consecutiveFailures).toBe(1);
    const second = deps(ok);
    await runChannels(second);
    const mine = second.post.mock.calls.filter(
      (call) => JSON.parse(call[1].payload).blocks.length > 1,
    );
    expect(mine.length).toBeGreaterThanOrEqual(1);
    expect((await store.getChannel(db, o, c.id))!.consecutiveFailures).toBe(0);
  });

  it('sends nothing for an account whose plan no longer includes channels', async () => {
    const o = owner('free');
    await channel(o);
    await alert(o, true);
    const d = deps(ok, false);
    await runChannels(d);
    expect(d.post).not.toHaveBeenCalled();
  });

  it('removal wipes the stored URL and stops delivery', async () => {
    const o = owner('rm');
    const c = await channel(o);
    expect(await store.removeChannel(db, o, c.id)).toBe(true);
    expect(await store.getChannel(db, o, c.id)).toBeNull();
    const { eq } = await import('drizzle-orm');
    const [row] = await db
      .select()
      .from(schema.notificationChannels)
      .where(eq(schema.notificationChannels.id, c.id));
    expect(row).toMatchObject({ urlCiphertext: '', enabled: false });
    expect(row!.deletedAt).not.toBeNull();
  });
});
