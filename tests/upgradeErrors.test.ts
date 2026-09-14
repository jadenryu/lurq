/**
 * Pinned: upgrade pages print each tool's literal message for a removed export,
 * name the replacement for a rename, stay silent where the message would be a
 * guess, and the check-upgrade hint only speaks to a person without a key.
 */
import { describe, expect, it } from 'vitest';
import {
  ERROR_NAMES_CAP,
  removedExportErrors,
  renamedExportErrors,
  typeExportErrors,
  upgradeErrors,
} from '../apps/web/src/lib/upgrade-errors';
import { connectHint } from '../src/cli/checkUpgrade';

describe('removedExportErrors', () => {
  it('gives each tool its own wording for a missing named export', () => {
    const errors = removedExportErrors('next/cache', 'unstable_cacheTag');
    expect(errors.map((e) => e.tool)).toEqual(['Node.js (ESM)', 'TypeScript', 'webpack', 'Vite / esbuild', 'Turbopack']);
    expect(errors[0]!.message).toBe(
      "SyntaxError: The requested module 'next/cache' does not provide an export named 'unstable_cacheTag'",
    );
    expect(errors[1]!.message).toBe(`error TS2305: Module '"next/cache"' has no exported member 'unstable_cacheTag'.`);
  });

  it('says nothing for a member path or a default export, where the message would be a guess', () => {
    expect(removedExportErrors('pkg', 'Foo.bar')).toEqual([]);
    expect(removedExportErrors('pkg', 'default')).toEqual([]);
  });
});

describe('renamedExportErrors', () => {
  it("uses TypeScript's did-you-mean message naming the new export", () => {
    const ts = renamedExportErrors('next/cache', 'unstable_cacheTag', 'cacheTag').find((e) => e.tool === 'TypeScript');
    expect(ts!.message).toBe(
      `error TS2724: Module '"next/cache"' has no exported member named 'unstable_cacheTag'. Did you mean 'cacheTag'?`,
    );
  });

  it('falls back to the plain removal messages when the new name is not a plain identifier', () => {
    expect(renamedExportErrors('pkg', 'old', 'Ns.new')).toEqual(removedExportErrors('pkg', 'old'));
  });
});

describe('upgradeErrors', () => {
  it('lists renames first, then removals, then types, and only types fail in TypeScript', () => {
    const out = upgradeErrors('pkg', {
      removed: [{ path: 'gone' }, { path: 'Ns.member' }],
      renamed: [{ path: 'oldName', to: ['newName'] }],
      typeOnlyRemoved: ['OldType'],
    });
    expect(out.map((e) => e.name)).toEqual(['oldName', 'gone', 'OldType']);
    expect(typeExportErrors('pkg', 'OldType').map((e) => e.tool)).toEqual(['TypeScript']);
  });

  it('caps the names a page prints', () => {
    const removed = Array.from({ length: ERROR_NAMES_CAP + 10 }, (_, i) => ({ path: `name${i}` }));
    expect(upgradeErrors('pkg', { removed, renamed: [], typeOnlyRemoved: [] })).toHaveLength(ERROR_NAMES_CAP);
  });
});

describe('connectHint', () => {
  it('speaks only when a readable report found a break on a machine without a key', () => {
    expect(connectHint({ json: false, breaking: 1, hasKey: false })).toMatch(/npx lurqrun setup/);
    expect(connectHint({ json: false, breaking: 0, hasKey: false })).toBeNull();
    expect(connectHint({ json: false, breaking: 2, hasKey: true })).toBeNull();
    expect(connectHint({ json: true, breaking: 2, hasKey: false })).toBeNull();
  });
});
