import { describe, expect, it } from 'vitest';
import { applyEdits, deterministic, editsByFile, type Edit, type Finding } from '../src/fix/types';

const edit = (over: Partial<Edit> = {}): Edit => ({ file: 'src/a.ts', start: 0, end: 3, text: 'xyz', ...over });

const finding = (over: Partial<Finding> = {}): Finding => ({
  domain: 'package',
  code: 'renamed-export',
  severity: 'blocking',
  detail: 'parse was renamed to parseCookie',
  ...over,
});

describe('applyEdits', () => {
  it('applies back to front, so earlier offsets stay valid', () => {
    const src = 'import { parse } from "cookie";\nparse(header);\n';
    const out = applyEdits(src, [
      { file: 'a.ts', start: 9, end: 14, text: 'parseCookie' },
      { file: 'a.ts', start: 32, end: 37, text: 'parseCookie' },
    ]);
    expect(out).toBe('import { parseCookie } from "cookie";\nparseCookie(header);\n');
  });

  it('is insensitive to the order edits arrive in', () => {
    const src = 'abcdef';
    const a: Edit[] = [edit({ start: 0, end: 1, text: 'A' }), edit({ start: 4, end: 5, text: 'E' })];
    expect(applyEdits(src, a)).toBe(applyEdits(src, [...a].reverse()));
    expect(applyEdits(src, a)).toBe('AbcdEf');
  });

  it('refuses overlapping edits rather than mangling the file', () => {
    expect(() =>
      applyEdits('abcdef', [edit({ start: 0, end: 3 }), edit({ start: 2, end: 4 })]),
    ).toThrow(/overlapping edits/);
  });

  it('refuses an edit outside the file, which means the file changed since detection', () => {
    expect(() => applyEdits('abc', [edit({ start: 0, end: 99 })])).toThrow(/out of range/);
    expect(() => applyEdits('abc', [edit({ start: 2, end: 1 })])).toThrow(/out of range/);
  });

  it('inserts without deleting when the range is empty', () => {
    expect(applyEdits('ab', [edit({ start: 1, end: 1, text: 'X' })])).toBe('aXb');
  });
});

describe('editsByFile', () => {
  it('collects every finding’s edits per file, so a writer touches each file once', () => {
    const byFile = editsByFile([
      finding({ fix: { summary: 'one', edits: [edit({ file: 'src/a.ts' }), edit({ file: 'src/b.ts', start: 5, end: 6 })] } }),
      finding({ fix: { summary: 'two', edits: [edit({ file: 'src/a.ts', start: 10, end: 11 })] } }),
      finding({ detail: 'nothing to do' }),
    ]);
    expect([...byFile.keys()].sort()).toEqual(['src/a.ts', 'src/b.ts']);
    expect(byFile.get('src/a.ts')).toHaveLength(2);
  });
});

describe('deterministic', () => {
  it('is true only for a finding that carries edits, never for an agent task', () => {
    expect(deterministic(finding({ fix: { summary: 'x', edits: [edit()] } }))).toBe(true);
    expect(deterministic(finding({ fix: { summary: 'x', task: { instruction: 'rewrite', files: [], evidence: [] } } }))).toBe(false);
    expect(deterministic(finding())).toBe(false);
  });
});
