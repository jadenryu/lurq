import { describe, it, expect, afterEach } from 'vitest';
import { PgDialect } from 'drizzle-orm/pg-core';
import { fillStatement, needsFill, resetSurfaceFill, scheduleFill } from '../src/pipeline/fillSurface';

const db = {} as never;
const row = (over: object) => ({ tier: 'shipped_js_ast' as const, sourceOffset: null, maxArity: null, ...over });

afterEach(() => resetSurfaceFill());

describe('which stored surfaces need filling', () => {
  it('only a tier-A surface with neither new column set anywhere', () => {
    expect(needsFill([row({}), row({})])).toBe(true);
    // One row carrying either value means this version was stored after 0037.
    expect(needsFill([row({}), row({ sourceOffset: 12 })])).toBe(false);
    expect(needsFill([row({}), row({ maxArity: 2 })])).toBe(false);
    expect(needsFill([row({ tier: 'bundled_dts' })])).toBe(false);
    expect(needsFill([])).toBe(false);
  });
});

describe('scheduling a fill', () => {
  it('tries each version once, and never waits on the fill', async () => {
    const calls: string[] = [];
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const fill = async (_db: unknown, pkg: string, version: string) => {
      calls.push(`${pkg}@${version}`);
      await gate;
      return 1;
    };
    expect(scheduleFill(db, 'cookie', '1.1.1', 7, fill)).toBe(true);
    // Still pending: the caller learns its answer is about to change.
    expect(scheduleFill(db, 'cookie', '1.1.1', 7, fill)).toBe(true);
    release();
    await resetSurfaceFill().catch(() => {});
    await new Promise((r) => setImmediate(r));
    expect(calls).toEqual(['cookie@1.1.1']);
  });

  it('runs one fill at a time', async () => {
    let running = 0;
    let peak = 0;
    const fill = async () => {
      running++;
      peak = Math.max(peak, running);
      await new Promise((r) => setTimeout(r, 5));
      running--;
      return 0;
    };
    for (let i = 0; i < 5; i++) scheduleFill(db, 'pkg', `1.0.${i}`, i, fill);
    await new Promise((r) => setTimeout(r, 80));
    expect(peak).toBe(1);
  });

  it('refuses past the queue cap instead of growing', () => {
    // Held open so the queue stays full while it is measured, then released so
    // the drain can finish.
    let release!: () => void;
    const gate = new Promise<number>((r) => (release = () => r(0)));
    const accepted = Array.from({ length: 40 }, (_, i) => scheduleFill(db, 'pkg', `2.0.${i}`, i, () => gate));
    // The first job leaves the queue for the drain, so the cap admits one more.
    expect(accepted.filter(Boolean).length).toBeLessThan(40);
    expect(accepted.at(-1)).toBe(false);
    release();
  });
});

// The production rule: no row is deleted or inserted, and a value already there is never overwritten.
describe('the fill statement', () => {
  it('updates only the two new columns, only where both are still empty', () => {
    const { sql, params } = new PgDialect().sqlToQuery(
      fillStatement(42, [
        { path: 'parse', offset: 2100, maxArity: 2 },
        { path: 'format', offset: null, maxArity: -1 },
      ]),
    );
    expect(sql).toMatch(/^\s*UPDATE symbols AS s\s+SET source_offset = v\.new_offset, max_arity = v\.new_max_arity/);
    expect(sql).toMatch(/s\.source_offset IS NULL\s+AND s\.max_arity IS NULL/);
    expect(sql).not.toMatch(/\b(DELETE|INSERT|TRUNCATE|DROP)\b/i);
    expect(params).toEqual(['parse', 2100, 2, 'format', null, -1, 42, 'shipped_js_ast']);
  });
});
