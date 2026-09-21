/**
 * Model identifiers that the provider has retired or dated.
 *
 * Two properties decide whether this ships. It must not be NOISE — an
 * identifier in a comment or a changelog is documentation, and a check that
 * reports those gets switched off. And the edits it produces must be SAFE: the
 * byte range has to land inside the quotes, carry the text it expects to find,
 * and survive being applied by the same function that writes real files.
 */
import { describe, expect, it } from 'vitest';
import { modelFindings, modelRefsIn } from '../src/fix/model';
import { TABLE_AS_OF, TRACKED_MODELS, staleness } from '../src/fix/modelIds';
import { applyEdits } from '../src/fix/types';

/** Fixed, so a dated finding reads the same next year as it does today. */
const NOW = new Date('2026-09-21T00:00:00Z');

/** One in-memory file, so no fixture tree is needed. */
const scan = (files: Record<string, string>, now = NOW) =>
  modelFindings('/repo', {
    files: Object.keys(files).map((f) => `/repo/${f}`),
    read: (absolute) => files[absolute.replace('/repo/', '')] ?? null,
    now,
  });

describe('modelRefsIn', () => {
  it('finds a tracked id in both literal spellings', () => {
    const refs = modelRefsIn(
      'src/a.ts',
      "const a = 'claude-3-5-sonnet-20241022';\nconst b = `claude-3-opus-20240229`;\n",
    );
    expect(refs.map((r) => [r.id, r.line])).toEqual([
      ['claude-3-5-sonnet-20241022', 1],
      ['claude-3-opus-20240229', 2],
    ]);
  });

  it('ignores an id that only appears in a comment', () => {
    // A regex detector reports this and is wrong. The AST is the whole reason.
    expect(modelRefsIn('src/a.ts', '// migrated off claude-3-opus-20240229 last year\n')).toEqual(
      [],
    );
  });

  it('ignores an id assembled at runtime, rather than guessing', () => {
    expect(modelRefsIn('src/a.ts', 'const m = `claude-3-opus-${date}`;\n')).toEqual([]);
  });

  it('says nothing about an id it has no row for', () => {
    expect(modelRefsIn('src/a.ts', "const m = 'claude-opus-5';\n")).toEqual([]);
    expect(modelRefsIn('src/a.ts', "const m = 'gpt-4o';\n")).toEqual([]);
  });

  it('points at the text inside the quotes, not the quotes', () => {
    const src = "const m = 'claude-2.0';\n";
    const [ref] = modelRefsIn('src/a.ts', src);
    expect(src.slice(ref!.range!.start, ref!.range!.end)).toBe('claude-2.0');
  });
});

describe('modelFindings', () => {
  it('blocks on a retired id and offers the swap as a real edit', () => {
    const src = "await client.messages.create({ model: 'claude-3-5-sonnet-20241022' });\n";
    const { findings } = scan({ 'src/ask.ts': src });

    expect(findings).toHaveLength(1);
    const [f] = findings;
    expect(f!.domain).toBe('model');
    expect(f!.severity).toBe('blocking');
    expect(f!.code).toBe('model-retired:claude-3-5-sonnet-20241022');
    expect(f!.detail).toContain('claude-sonnet-5');
    expect(f!.evidence).toContain('src/ask.ts:1');
    expect(f!.evidence).toContain(TABLE_AS_OF);

    // The edit has to survive the function that writes files for real.
    expect(applyEdits(src, f!.fix!.edits!)).toBe(
      "await client.messages.create({ model: 'claude-sonnet-5' });\n",
    );
  });

  it("warns about a dated id and does NOT edit it — that move is the user's call", () => {
    const { findings } = scan({ 'src/ask.ts': "const m = 'claude-3-haiku-20240307';\n" });
    expect(findings[0]!.severity).toBe('warning');
    expect(findings[0]!.fix!.edits).toBeUndefined();
    expect(findings[0]!.fix!.task!.instruction).toContain('claude-haiku-4-5');
    // 2026-04-19 is behind NOW, and a date that has passed must read as past.
    expect(findings[0]!.detail).toContain('days ago');
  });

  it('says there is no deadline rather than inventing one', () => {
    const { findings } = scan({ 'src/ask.ts': "const m = 'claude-sonnet-4-0';\n" });
    expect(findings[0]!.detail).toContain('has not announced');
    expect(findings[0]!.fix!.task!.evidence).toContain('status: deprecated, no announced date');
  });

  it('reports one finding per id and edits every site of it', () => {
    const { findings } = scan({
      'src/a.ts': "const m = 'claude-2.0';\n",
      'src/b.ts': "export const M = 'claude-2.0';\nconst n = 'claude-2.0';\n",
    });
    expect(findings).toHaveLength(1);
    expect(findings[0]!.fix!.edits).toHaveLength(3);
    expect(findings[0]!.detail).toContain('3 places');
  });

  it('never reports the table that defines the ids', () => {
    // lurq scanned by lurq. A tool whose first act on its own repo is fifteen
    // false findings has answered whether to trust it.
    const { findings, refs } = scan({
      'src/fix/modelIds.ts': "{ id: 'claude-2.0', status: 'retired' }\n",
    });
    expect(refs).toEqual([]);
    expect(findings).toEqual([]);
  });

  it('never reports a test fixture, whose ids are asserted on rather than called', () => {
    // Found by running this on lurq itself: every finding was a fixture, and
    // the edits would have rewritten the tests that prove the detector works.
    const { findings } = scan({
      'tests/ask.test.ts': "expect(m).toBe('claude-2.0');\n",
      'src/__tests__/a.ts': "const m = 'claude-2.0';\n",
      'e2e/flow.ts': "const m = 'claude-2.0';\n",
    });
    expect(findings).toEqual([]);
  });

  it('is silent on a project with no tracked ids', () => {
    expect(scan({ 'src/a.ts': "const m = 'claude-opus-5';\n" }).findings).toEqual([]);
  });
});

describe('the table itself', () => {
  it('names a successor that is not itself tracked as retired or deprecated', () => {
    // A table that points a retired model at another retired model produces a
    // fix that needs a second fix, and that is worse than no fix at all.
    for (const model of TRACKED_MODELS.values()) {
      expect(TRACKED_MODELS.has(model.successor), `${model.id} -> ${model.successor}`).toBe(false);
    }
  });

  it('admits when it has not been checked in a long time', () => {
    expect(staleness(NOW)).toBeNull();
    const later = new Date(NOW.getTime() + 400 * 86_400_000);
    expect(staleness(later)).toContain(TABLE_AS_OF);
    expect(
      scan({ 'src/a.ts': "const m = 'claude-2.0';\n" }, later).findings[0]!.evidence,
    ).toContain('last checked');
  });
});
