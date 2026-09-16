import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { unifiedDiff } from '../src/fix/diff';
import type { Edit } from '../src/fix/types';

const edit = (over: Partial<Edit>): Edit => ({ file: 'src/a.ts', start: 0, end: 0, text: '', ...over });

/** 12 numbered lines, so hunk headers are checkable by eye. */
const numbered = Array.from({ length: 12 }, (_, i) => `line${i + 1}`).join('\n') + '\n';
const at = (line: number, text: string) => {
  const start = numbered.indexOf(text, numbered.split('\n').slice(0, line - 1).join('\n').length);
  return { start, end: start + text.length };
};

describe('unifiedDiff', () => {
  it('is empty when there is nothing to write', () => {
    expect(unifiedDiff('src/a.ts', numbered, [])).toBe('');
  });

  it('prints a git-appliable header and three lines of context either side', () => {
    const { start, end } = at(6, 'line6');
    const out = unifiedDiff('src/a.ts', numbered, [edit({ start, end, text: 'SIX', was: 'line6' })]);
    expect(out).toBe(
      [
        '--- a/src/a.ts',
        '+++ b/src/a.ts',
        '@@ -3,7 +3,7 @@',
        ' line3',
        ' line4',
        ' line5',
        '-line6',
        '+SIX',
        ' line7',
        ' line8',
        ' line9',
        '',
      ].join('\n'),
    );
  });

  it('merges changes whose context would overlap into one hunk', () => {
    const a = at(2, 'line2');
    const b = at(5, 'line5');
    const out = unifiedDiff('src/a.ts', numbered, [
      edit({ ...a, text: 'TWO', was: 'line2' }),
      edit({ ...b, text: 'FIVE', was: 'line5' }),
    ]);
    expect(out.match(/^@@/gm)).toHaveLength(1);
    expect(out).toContain('-line2');
    expect(out).toContain('+TWO');
    expect(out).toContain('-line5');
    expect(out).toContain('+FIVE');
    // One run of removals then one of additions, so the hunk stays a valid patch.
    expect(out).toMatch(/-line2\n-line3\n-line4\n-line5\n\+TWO\n\+line3\n\+line4\n\+FIVE\n/);
  });

  it('splits changes that are far apart, and offsets the second hunk by the first’s delta', () => {
    const a = at(1, 'line1');
    const b = at(12, 'line12');
    const out = unifiedDiff('src/a.ts', numbered, [
      edit({ ...a, text: 'one\nextra', was: 'line1' }),
      edit({ ...b, text: 'TWELVE', was: 'line12' }),
    ]);
    const headers = out.match(/^@@.*$/gm)!;
    expect(headers).toHaveLength(2);
    expect(headers[0]).toBe('@@ -1,4 +1,5 @@');
    // The first hunk added a line, so the second hunk's new-side start moves by one.
    expect(headers[1]).toBe('@@ -9,4 +10,4 @@');
  });

  it('marks both sides when the file has no trailing newline, which git requires', () => {
    const src = 'a\nb\nc';
    const out = unifiedDiff('src/a.ts', src, [edit({ start: 4, end: 5, text: 'C', was: 'c' })]);
    expect(out).toBe(
      [
        '--- a/src/a.ts',
        '+++ b/src/a.ts',
        '@@ -1,3 +1,3 @@',
        ' a',
        ' b',
        '-c',
        '\\ No newline at end of file',
        '+C',
        '\\ No newline at end of file',
        '',
      ].join('\n'),
    );
  });

  it('marks the final context line when the change is above it', () => {
    const src = 'a\nb\nc\nd';
    const out = unifiedDiff('src/a.ts', src, [edit({ start: 0, end: 1, text: 'A', was: 'a' })]);
    expect(out.endsWith(' d\n\\ No newline at end of file\n')).toBe(true);
  });

  it('says nothing about newlines for a file that ends in one', () => {
    expect(unifiedDiff('src/a.ts', 'a\nb\n', [edit({ start: 0, end: 1, text: 'A', was: 'a' })])).not.toContain(
      'No newline',
    );
  });
});

/**
 * The claim in diff.ts is that `git apply` accepts this output. That is not
 * something to assert by reading the format spec — the first version of this
 * renderer omitted the no-newline marker and git rejected every patch for a
 * file that lacked a trailing newline. So git itself is the assertion.
 */
describe('git apply', () => {
  const check = (name: string, before: string, edits: Edit[]) => {
    const dir = mkdtempSync(join(tmpdir(), 'lurq-gitapply-'));
    try {
      execFileSync('git', ['init', '-q'], { cwd: dir });
      mkdirSync(join(dir, 'src'), { recursive: true });
      writeFileSync(join(dir, name), before, 'utf8');
      writeFileSync(join(dir, 'p.patch'), unifiedDiff(name, before, edits), 'utf8');
      // Throws with git's own message if the patch is malformed or does not fit.
      execFileSync('git', ['apply', '--check', '--verbose', 'p.patch'], { cwd: dir, stdio: 'pipe' });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  };

  it('accepts a patch for a file that ends in a newline', () => {
    expect(() => check('src/a.ts', numbered, [edit({ ...at(6, 'line6'), text: 'SIX', was: 'line6' })])).not.toThrow();
  });

  it('accepts a patch for a file that does not end in a newline', () => {
    const src = 'line1\nline2\nline3';
    expect(() => check('src/a.ts', src, [edit({ start: 12, end: 17, text: 'THREE', was: 'line3' })])).not.toThrow();
  });

  it('accepts a multi-hunk patch', () => {
    expect(() =>
      check('src/a.ts', numbered, [
        edit({ ...at(1, 'line1'), text: 'ONE', was: 'line1' }),
        edit({ ...at(12, 'line12'), text: 'TWELVE', was: 'line12' }),
      ]),
    ).not.toThrow();
  });

  it('refuses to print a diff for an offset that no longer holds what was read', () => {
    expect(() => unifiedDiff('src/a.ts', numbered, [edit({ start: 0, end: 5, text: 'x', was: 'other' })])).toThrow(
      /changed since it was read/,
    );
  });
});
