/**
 * Model identifiers in source that the provider has retired or dated.
 *
 * The same failure `env.ts` catches, moved one layer out: the code is correct,
 * the manifest is current, every test passes, and the call fails anyway —
 * because a string in it names something that no longer exists. Nothing in a
 * dependency toolchain looks at string literals, so this is invisible until
 * production returns a 404.
 *
 * Three decisions carry this file, and the first two are `env.ts`'s for the
 * same reasons:
 *
 *   - Literals are found through the TypeScript AST, not a regex. An identifier
 *     inside a comment, a changelog, or a doc block is documentation, not a
 *     call, and a detector that reports those is noise — and a noisy check gets
 *     switched off, which costs more than never shipping it.
 *   - Matching is EXACT against `TRACKED_MODELS`. No prefixes, no fuzzy
 *     `claude-*` catch-all. A literal lurq has no sourced row for produces no
 *     finding, because "this looks like a model id and I have no idea about it"
 *     is not worth interrupting anyone for.
 *   - One finding per identifier, not per site. A project that names the same
 *     retired model in fourteen files has one problem; fourteen findings for it
 *     is a report nobody reads. Every site is cited, and every site is edited.
 *
 * Retired identifiers get deterministic `edits`, dated ones get a `task`. The
 * split is the safety story: a retired model's call is broken NOW and swapping
 * in the successor the provider names is the smallest change that makes it run
 * again, reviewable as a diff. A deprecated model still works, so choosing when
 * to move — and whether the successor's cost and behaviour suit — belongs to
 * the user, not to a robot with a calendar.
 */
import { readFileSync } from 'node:fs';
import { relative } from 'node:path';
import ts from 'typescript';
import { listSourceFiles } from '../surface/references';
import { HARNESS_FILE } from './env';
import type { Edit, Finding } from './types';
import { TABLE_AS_OF, TRACKED_MODELS, daysBetween, staleness, type TrackedModel } from './modelIds';

/**
 * The table's own module, which is full of the identifiers it tracks.
 *
 * Only ever true when lurq is scanned by lurq, and that is exactly the run
 * worth getting right — a tool whose first act on its own repository is to
 * report fifteen false findings has answered the question of whether to trust
 * it. Matched on the path suffix rather than an AST rule about declarations
 * versus uses, because one string comparison is the whole fix.
 *
 * ponytail: path suffix. If a project ever legitimately owns a file by that
 * name, narrow it to a value-position check against the table's own const.
 */
const TABLE_MODULE = /(^|\/)src\/fix\/modelIds\.ts$/;

/**
 * Where a tracked identifier is not worth reporting.
 *
 * `TABLE_MODULE` is lurq's own catalogue; `HARNESS_FILE` is any project's
 * tests and fixtures. Both were found by running this detector on this
 * repository, where every finding it produced was one of the two — a test
 * asserting on a retired id, and the table defining it. Neither is a call that
 * fails, and applying the edits would have rewritten the tests that prove the
 * detector works.
 *
 * An integration test that really does call a retired model still fails, in
 * the user's own test run, which is the cheapest place there is to find out.
 */
const skipFile = (file: string): boolean => TABLE_MODULE.test(file) || HARNESS_FILE.test(file);

/** A tracked identifier, written at one place in one file. */
export interface ModelRef {
  id: string;
  /** Repo-relative, so a finding cites something the reader can open. */
  file: string;
  line: number;
  /**
   * Byte range of the identifier's TEXT — inside the quotes, so replacing it
   * cannot disturb the quoting style the file already uses. `null` when the
   * source spelling is not the plain identifier (an escape sequence), which
   * makes an offset-based replacement unsafe and downgrades the fix to a brief.
   */
  range: { start: number; end: number } | null;
}

/**
 * Every tracked model identifier written as a literal in one file.
 *
 * Both spellings a literal has: a quoted string, and a template with nothing
 * interpolated into it. A template WITH a substitution is skipped — the value
 * is assembled at runtime and is not in the source to match.
 */
export function modelRefsIn(file: string, text: string): ModelRef[] {
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
  const out: ModelRef[] = [];

  const push = (node: ts.StringLiteralLike) => {
    if (!TRACKED_MODELS.has(node.text)) return;
    // Inside the delimiters: one character in from each end, for both `'` and
    // the backtick. Taken from the source text rather than assumed, so a
    // literal whose raw spelling differs from its value (an escape) is caught
    // here and reported without an edit instead of producing a bad offset.
    const start = node.getStart(sf) + 1;
    const end = node.getEnd() - 1;
    const verbatim = text.slice(start, end) === node.text;
    out.push({
      id: node.text,
      file,
      line: sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1,
      range: verbatim ? { start, end } : null,
    });
  };

  const visit = (node: ts.Node): void => {
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) push(node);
    ts.forEachChild(node, visit);
  };

  visit(sf);
  return out;
}

export interface ModelPlan {
  findings: Finding[];
  /** Every tracked reference found, for a report's denominator. */
  refs: ModelRef[];
  /** A source file past the scan limit was never opened. Never folded away. */
  truncated: boolean;
}

export interface ModelOptions {
  limit?: number;
  /** Injectable clock, so a dated finding is testable without waiting. */
  now?: Date;
  /** Injectable reader, so tests need no fixture tree. */
  read?: (absolute: string) => string | null;
  /** Override discovery, same reason. Absolute paths. */
  files?: string[];
}

/** `in 41 days`, `41 days ago`, or `on an unannounced date`. */
function when(date: string | null, now: Date): string {
  if (!date) return 'on a date the provider has not announced';
  const days = daysBetween(now, new Date(date));
  if (days > 0) return `in ${days} day${days === 1 ? '' : 's'} (${date})`;
  if (days === 0) return `today (${date})`;
  return `${-days} day${days === -1 ? '' : 's'} ago (${date})`;
}

function detailFor(model: TrackedModel, now: Date, sites: number): string {
  const where = `${sites} place${sites === 1 ? '' : 's'}`;
  return model.status === 'retired'
    ? `${model.id} was retired by ${model.vendor} ${when(model.date, now)} — every call naming it fails, and it is written in ${where}. ${model.successor} replaces it.`
    : `${model.id} is deprecated by ${model.vendor} and stops serving ${when(model.date, now)}. It is written in ${where}. ${model.successor} replaces it.`;
}

/**
 * Findings for model identifiers the provider has retired or put an end date on.
 *
 * `blocking` for retired, because the call is already failing and no judgement
 * is needed to know that. `warning` for deprecated, because it works today and
 * the deadline is information rather than an emergency.
 */
export function modelFindings(root: string, opts: ModelOptions = {}): ModelPlan {
  const now = opts.now ?? new Date();
  const listing = opts.files
    ? { files: opts.files, truncated: false }
    : listSourceFiles(root, opts.limit);
  const read =
    opts.read ??
    ((absolute: string) => {
      try {
        return readFileSync(absolute, 'utf8');
      } catch {
        return null;
      }
    });

  const refs: ModelRef[] = [];
  for (const absolute of listing.files) {
    const file = relative(root, absolute) || absolute;
    if (skipFile(file)) continue;
    const text = read(absolute);
    if (text === null) continue;
    refs.push(...modelRefsIn(file, text));
  }

  const byId = new Map<string, ModelRef[]>();
  for (const ref of refs) {
    const list = byId.get(ref.id);
    if (list) list.push(ref);
    else byId.set(ref.id, [ref]);
  }

  const note = staleness(now);
  const findings: Finding[] = [...byId]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([id, sites]) => {
      const model = TRACKED_MODELS.get(id)!;
      const files = [...new Set(sites.map((s) => s.file))];
      const cited = sites.slice(0, 5).map((s) => `${s.file}:${s.line}`);
      const evidence = [
        `written at ${cited.join(', ')}${sites.length > 5 ? ` and ${sites.length - 5} more` : ''}`,
        `lurq's model table, as of ${TABLE_AS_OF}`,
        ...(note ? [note] : []),
      ].join('; ');

      // Only for a model that is already dead, and only for sites whose source
      // spelling is the identifier itself. A site that cannot be edited safely
      // is still cited above — it is reported, just not rewritten.
      const edits: Edit[] =
        model.status === 'retired'
          ? sites
              .filter((s) => s.range)
              .map((s) => ({
                file: s.file,
                start: s.range!.start,
                end: s.range!.end,
                text: model.successor,
                was: id,
              }))
          : [];

      return {
        domain: 'model' as const,
        code: `model-${model.status}:${id}`,
        severity: model.status === 'retired' ? ('blocking' as const) : ('warning' as const),
        detail: detailFor(model, now, sites.length),
        file: sites[0]!.file,
        evidence,
        fix: {
          summary:
            model.status === 'retired'
              ? `replace ${id} with ${model.successor}`
              : `plan the move from ${id} to ${model.successor} before it stops serving`,
          ...(edits.length ? { edits } : {}),
          task: {
            instruction:
              `${id} is ${model.status}; ${model.vendor} names ${model.successor} as its replacement. Swap the identifier at the sites listed. ` +
              'A newer model is not a drop-in: re-check anything the call sets that the replacement may reject or price differently, ' +
              'and do not invent an identifier — use exactly the one given here.',
            files,
            evidence: [
              `${sites.length} reference(s)`,
              `status: ${model.status}${model.date ? `, ${model.date}` : ', no announced date'}`,
              ...cited,
            ],
          },
          verify: ['tests'],
        },
      };
    });

  return { findings, refs, truncated: listing.truncated };
}
