/**
 * The migration journal, checked for the one property Drizzle silently depends on.
 *
 * Drizzle does NOT apply migrations in journal order. `PgDialect.migrate` reads
 * the single newest `created_at` out of `__drizzle_migrations` ONCE, then applies
 * every entry whose `when` exceeds that one high-water mark:
 *
 *     const lastDbMigration = (select ... order by created_at desc limit 1)[0];
 *     for (const migration of migrations)
 *       if (!lastDbMigration || lastDbMigration.created_at < migration.folderMillis) ...
 *
 * So an entry whose `when` is OLDER than the entry before it is skipped forever
 * on any database that already sits at that mark — while later entries still
 * apply, against the schema the skipped one was supposed to create.
 *
 * That is not hypothetical: it took the production API down on 2026-09-16.
 * Merging two branches that had each numbered their migrations from the same
 * point renumbered the files (0044/0045 -> 0048/0049) but kept their original
 * timestamps, leaving 0048 older than 0047. Production, sitting at 0047, skipped
 * 0048 and ran 0049, which failed with `42P01: relation
 * "mcp_remote_endpoints" does not exist` — the table 0048 creates. The start
 * command is `db migrate && serve-http`, so the server never booted.
 *
 * No test caught it because a FRESH database has no high-water mark at all
 * (`!lastDbMigration`), so every migration applies and the suite passes. Only an
 * incremental database reproduces it, which in practice means production.
 * Hence this file: it asserts the invariant against the journal itself, where a
 * bad merge is visible without any database at all.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

interface JournalEntry {
  idx: number;
  when: number;
  tag: string;
}

const journalUrl = new URL('../drizzle/meta/_journal.json', import.meta.url);
const migrationsUrl = new URL('../drizzle/', import.meta.url);

const entries: JournalEntry[] = (
  JSON.parse(readFileSync(journalUrl, 'utf8')) as { entries: JournalEntry[] }
).entries;

describe('the drizzle migration journal', () => {
  it('has entries', () => {
    expect(entries.length).toBeGreaterThan(0);
  });

  it('increases `when` strictly, which is what decides whether a migration runs', () => {
    // The failure this guards. Reported as pairs so the message names the two
    // entries to fix rather than just a count.
    const regressions = entries
      .slice(1)
      .map((entry, i) => ({ prev: entries[i]!, entry }))
      .filter(({ prev, entry }) => entry.when <= prev.when)
      .map(({ prev, entry }) => `${prev.tag} (${prev.when}) -> ${entry.tag} (${entry.when})`);

    expect(regressions, 'a migration whose `when` is not newer than the entry before it will be skipped on an existing database').toEqual([]);
  });

  it('keeps `idx` in step with position, so the order on disk is the order here', () => {
    expect(entries.map((e) => e.idx)).toEqual(entries.map((_, i) => i));
  });

  it('numbers `when` in the same order the tags are numbered', () => {
    // A merge can leave these disagreeing: the files get renumbered to resolve
    // the collision while their timestamps keep the old branch's ordering. When
    // they disagree, the tag order is the lie and `when` is what actually runs.
    const byWhen = [...entries].sort((a, b) => a.when - b.when).map((e) => e.tag);
    expect(byWhen).toEqual(entries.map((e) => e.tag));
  });

  it('points every entry at a migration file that exists', () => {
    const onDisk = new Set(readdirSync(migrationsUrl).filter((f) => f.endsWith('.sql')));
    const missing = entries.map((e) => `${e.tag}.sql`).filter((f) => !onDisk.has(f));
    expect(missing, 'journal names a migration with no file; drizzle throws at startup').toEqual([]);
  });

  it('lists every migration file in the journal', () => {
    // The other direction: a committed .sql file absent from the journal never
    // runs, which is the same outage arriving quietly instead of loudly.
    const tagged = new Set(entries.map((e) => `${e.tag}.sql`));
    const orphans = readdirSync(migrationsUrl)
      .filter((f) => f.endsWith('.sql'))
      .filter((f) => !tagged.has(f));
    expect(orphans, 'migration file not in the journal, so it will never be applied').toEqual([]);
  });
});
