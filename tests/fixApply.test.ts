/**
 * Staging, which is the part that can damage a working tree.
 *
 * `lurq fix --apply` writes only after every file has been staged, so the
 * property under test is not "it writes the right bytes" — that is applyEdits —
 * but "when one file has moved, nothing is written at all".
 */
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { stage } from '../src/cli/fix';
import type { Edit, Finding } from '../src/fix/types';

let root: string;

const A = `import { parse } from 'cookie';\nexport const read = (h: string) => parse(h);\n`;
const B = `import { parse } from 'cookie';\nexport const other = (h: string) => parse(h);\n`;

const write = (rel: string, src: string) => {
  mkdirSync(join(root, rel, '..'), { recursive: true });
  writeFileSync(join(root, rel), src, 'utf8');
};

/** The import-name range in both fixtures: `parse` at offset 9. */
const importEdit = (file: string): Edit => ({
  file,
  start: 9,
  end: 14,
  text: 'parseCookie',
  was: 'parse',
});

const finding = (edits: Edit[]): Finding => ({
  domain: 'package',
  code: 'renamed-export:cookie:parse',
  severity: 'blocking',
  detail: 'parse was renamed to parseCookie',
  fix: { summary: 'rename parse to parseCookie', edits },
});

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'lurq-stage-'));
  write('src/a.ts', A);
  write('src/b.ts', B);
});

afterEach(() => rmSync(root, { recursive: true, force: true }));

describe('stage', () => {
  it('returns the new contents for every file, and writes none of them', () => {
    const { writes, diff } = stage(root, [
      finding([importEdit('src/a.ts'), importEdit('src/b.ts')]),
    ]);

    expect([...writes.keys()].sort()).toEqual(['src/a.ts', 'src/b.ts']);
    expect(writes.get('src/a.ts')).toContain("import { parseCookie } from 'cookie';");
    expect(diff).toContain('--- a/src/a.ts');
    expect(diff).toContain('+++ b/src/b.ts');
    // Staging is a read. The files on disk are untouched until the caller writes.
    expect(readFileSync(join(root, 'src/a.ts'), 'utf8')).toBe(A);
    expect(readFileSync(join(root, 'src/b.ts'), 'utf8')).toBe(B);
  });

  it('refuses the whole batch when one file moved since it was read', () => {
    // Another agent reformatted b.ts between the scan and the write.
    write(
      'src/b.ts',
      `import {parse} from 'cookie';\nexport const other = (h: string) => parse(h);\n`,
    );

    expect(() => stage(root, [finding([importEdit('src/a.ts'), importEdit('src/b.ts')])])).toThrow(
      /src\/b\.ts changed since it was read/,
    );
    expect(readFileSync(join(root, 'src/a.ts'), 'utf8')).toBe(A);
  });

  it('ignores findings that carry no edits, so a brief never reaches the writer', () => {
    const brief: Finding = {
      domain: 'package',
      code: 'removed-export:cookie:parse',
      severity: 'blocking',
      detail: 'parse is gone',
      fix: {
        summary: 'ask the agent',
        task: { instruction: 'rewrite it', files: ['src/a.ts'], evidence: [] },
      },
    };
    const { writes, diff } = stage(root, [brief]);
    expect(writes.size).toBe(0);
    expect(diff).toBe('');
  });
});
