/**
 * One shape for "something is wrong, and here is the change that fixes it".
 *
 * lurq already detects across four domains — packages, MCP servers and their
 * configs, declared environment, API specs — and each one grew its own report
 * shape. That is fine for printing and useless for acting: an auto-fix loop
 * needs every domain to hand back the same thing, so one engine can apply it,
 * verify it, open the pull request and record what happened.
 *
 * Two kinds of fix, and the distinction is the whole safety story:
 *
 *   - `edits`: byte ranges computed from evidence lurq can prove (a rename the
 *     package itself proves, a config key that client documents). Deterministic,
 *     reviewable as a diff, no model involved, safe to apply unattended.
 *   - `task`: a brief for the agent that already runs in the upgrade workflow,
 *     for changes no rule can make. Never applied without the user's own CI
 *     running their tests, which is what the existing workflow does.
 *
 * A finding with neither is still worth returning: it says what is wrong when
 * nothing can be done about it automatically, which is most of the value of an
 * honest report.
 */

export type FixDomain = 'package' | 'mcp-config' | 'env' | 'api';

export type FixSeverity = 'blocking' | 'warning' | 'info';

/**
 * What a policy decides to do about a finding.
 *
 * Declared, and deliberately not yet consumed: nothing in this branch chooses
 * an action, so these describe intent rather than behaviour. `lurq fix` today
 * makes the one choice it can defend without a policy — apply what is proven,
 * brief the rest — and the severity-to-action matrix lands with the
 * zero-decision defaults.
 */
export type FixAction =
  /** Apply it without asking. Only ever chosen for `edits`. */
  | 'auto'
  /** Apply it on a branch and open a pull request. */
  | 'pr'
  /** Report it; change nothing. */
  | 'warn'
  /** Report it and ask the user, because only they hold what it needs (a key, a URL). */
  | 'ask';

/** A byte range in one file, replaced with `text`. Ranges never overlap within a file. */
export interface Edit {
  /** Path as the detector reported it: relative to the project root. */
  file: string;
  /** Character offsets into the file as read, half-open [start, end). */
  start: number;
  end: number;
  text: string;
  /**
   * What the range held when the detector read it. Offsets are only meaningful
   * against those exact bytes, and between detection and the write the file can
   * move — another agent edits it, a formatter runs, the branch changes. Set it
   * and every apply path checks it, so a stale offset is a refusal instead of a
   * rename dropped into the middle of an unrelated identifier.
   */
  was?: string;
}

/** A brief for the agent that runs in the user's own CI, when no rule can do it. */
export interface FixTask {
  /** Imperative, one line: what to change. */
  instruction: string;
  /** Files it may touch, so the agent is not let loose on the repository. */
  files: string[];
  /** Facts the agent must not invent: exports that exist, the replacement's arity. */
  evidence: string[];
}

export interface Fix {
  /** What applying this does, in the user's words. Shown in the diff and the PR. */
  summary: string;
  /** Deterministic replacement. Present means no model is needed. */
  edits?: Edit[];
  task?: FixTask;
  /**
   * How to know it worked. `typecheck` and `tests` are the user's own commands;
   * `probe` re-reads the thing that was wrong (an MCP endpoint, a spec).
   */
  verify?: ('typecheck' | 'tests' | 'probe')[];
}

export interface Finding {
  domain: FixDomain;
  /** Stable across runs for the same problem: the dedupe and acknowledgement key. */
  code: string;
  severity: FixSeverity;
  /** One line, specific enough to act on without opening anything else. */
  detail: string;
  /** Where it is: a source file, a config file, a manifest. Relative to the root. */
  file?: string;
  /** The key inside that file, when it has one: `mcpServers.github`, `dependencies`. */
  section?: string;
  /** What lurq read to believe this, and when. Never a guess presented as a fact. */
  evidence?: string;
  fix?: Fix;
}

export interface FixPlan {
  root: string;
  findings: Finding[];
  /** Files read, for the report's provenance line. */
  filesRead: string[];
  /** Detection problems: a malformed config is reported, never swallowed. */
  notes: string[];
}

/** Findings whose fix can be applied with no model and no network. */
export const deterministic = (f: Finding): boolean => Boolean(f.fix?.edits?.length);

/**
 * Apply edits to file contents. Pure, so the writer and the dry-run diff share
 * one implementation and cannot disagree about what would be written.
 *
 * Applied back-to-front so earlier offsets stay valid, and overlapping ranges
 * are refused rather than silently producing a mangled file.
 */
export function applyEdits(contents: string, edits: Edit[]): string {
  const sorted = [...edits].sort((a, b) => a.start - b.start);
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i]!.start < sorted[i - 1]!.end) {
      throw new Error(`overlapping edits at ${sorted[i - 1]!.start}-${sorted[i - 1]!.end} and ${sorted[i]!.start}-${sorted[i]!.end}`);
    }
  }
  let out = contents;
  for (const e of [...sorted].reverse()) {
    if (e.start < 0 || e.end > out.length || e.end < e.start) {
      throw new Error(`edit out of range: ${e.start}-${e.end} in ${e.file} (${out.length} chars)`);
    }
    const found = out.slice(e.start, e.end);
    if (e.was !== undefined && found !== e.was) {
      throw new Error(
        `${e.file} changed since it was read: expected ${JSON.stringify(e.was)} at ${e.start}-${e.end}, found ${JSON.stringify(found)}`,
      );
    }
    out = out.slice(0, e.start) + e.text + out.slice(e.end);
  }
  return out;
}

/** Group edits by file, so a writer touches each file once. */
export function editsByFile(findings: Finding[]): Map<string, Edit[]> {
  const byFile = new Map<string, Edit[]>();
  for (const f of findings) {
    for (const e of f.fix?.edits ?? []) {
      const list = byFile.get(e.file);
      if (list) list.push(e);
      else byFile.set(e.file, [e]);
    }
  }
  return byFile;
}
