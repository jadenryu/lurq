/**
 * `lurq fix` — the other half of `check-upgrade`.
 *
 * `check-upgrade` says "this upgrade removes `parse`, and you call it in four
 * files". Useful, and it still leaves the user holding the work. Where the
 * package itself proves what replaced a symbol, that work is mechanical, and a
 * tool that knows the answer should write it.
 *
 * Two rules keep this safe enough to run unattended:
 *
 *   - Nothing is applied that lurq cannot prove. A rename is written only when
 *     the removed name and its survivor were exported from the same declaration
 *     at the old version and the survivor still exists at the new one. Anything
 *     with a choice in it comes back as a brief for the agent, never as an edit.
 *   - Offsets are checked against the bytes they were read from. Between the
 *     scan and the write, another agent can touch the same file; `was` on each
 *     edit turns that into a refusal instead of a rename dropped into the wrong
 *     identifier.
 *
 * Default mode prints a unified diff and writes nothing, because the first time
 * anyone runs a tool that edits their source, the correct output is something
 * they can read.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { deterministic, editsByFile, applyEdits, type Finding } from '../fix/types';
import { unifiedDiff } from '../fix/diff';
import { SCAN_LIMIT, parseUpgradeSpec, targetsFromPlanFile } from './checkUpgrade';

export interface FixOpts {
  /** Targets from `upgrade-plan --json`. */
  plan?: string;
  /** `pkg@from..to`, repeatable. */
  upgrade?: string[];
  /** Write the files. Off by default: the default is a diff. */
  apply?: boolean;
  json?: boolean;
  /** Exit 1 when something is left for a human or an agent to do. */
  exitCode?: boolean;
}

interface FixResult {
  root: string;
  /** Files written, or that would be written. */
  files: string[];
  /** Deterministic renames, applied or previewed. */
  applied: { code: string; summary: string; files: string[] }[];
  /** Everything that needs a decision, with the brief for making it. */
  remaining: {
    code: string;
    detail: string;
    instruction?: string;
    files?: string[];
    /** The facts the rewrite must not invent: the exports the new version ships. */
    evidence?: string[];
  }[];
  /** Why a proven rename was not written here. */
  refused: { symbol: string; reason: string }[];
}

/**
 * The plan, and the exact contents each file would end up with.
 *
 * Every file is staged before any of it is written, so a stale offset in the
 * fourth file cannot leave the first three rewritten and the working tree in a
 * state nobody asked for. It throws rather than skipping the bad file: a
 * partially applied rename is worse than none, because the build now fails for
 * a reason the tool invented.
 */
export function stage(root: string, findings: Finding[]): { writes: Map<string, string>; diff: string } {
  const writes = new Map<string, string>();
  let diff = '';
  for (const [file, edits] of editsByFile(findings.filter(deterministic))) {
    // Read once per file and compute both the diff and the new contents from
    // that same read, so the preview cannot describe a write that differs.
    const before = readFileSync(join(root, file), 'utf8');
    diff += unifiedDiff(file, before, edits);
    writes.set(file, applyEdits(before, edits));
  }
  return { writes, diff };
}

export async function runFix(dir: string, opts: FixOpts): Promise<void> {
  const { scanReferences } = await import('../surface/references');
  const { checkUpgrade } = await import('../surface/upgrade');
  const { renamePlan } = await import('../fix/rename');

  const targets = [
    ...(opts.plan ? targetsFromPlanFile(opts.plan) : []),
    ...(opts.upgrade ?? []).map(parseUpgradeSpec),
  ];
  if (targets.length === 0) {
    if (opts.plan) {
      const empty: FixResult = { root: dir, files: [], applied: [], remaining: [], refused: [] };
      console.log(opts.json ? JSON.stringify(empty, null, 2) : 'Nothing to fix.');
      return;
    }
    throw new Error('give --plan <file> or at least one --upgrade pkg@from..to');
  }

  // No type check: a rename is a fact about the runtime surface, and the type
  // check is the slowest part of `check-upgrade`. `lurq check-upgrade` is still
  // the gate; this is the writer.
  const refs = scanReferences(dir, { limit: SCAN_LIMIT });
  const report = await checkUpgrade(targets, refs, { rootDir: dir });
  const { findings, refused } = renamePlan(report);

  const result: FixResult = {
    root: dir,
    files: [],
    applied: [],
    remaining: [],
    refused: refused.map((r) => ({ symbol: r.symbol, reason: r.reason })),
  };

  // Stage every file before writing any of it. A stale offset in the fourth
  // file must not leave the first three rewritten.
  const { writes, diff } = stage(dir, findings);
  result.files = [...writes.keys()];
  for (const f of findings) {
    if (deterministic(f)) {
      result.applied.push({
        code: f.code,
        summary: f.fix!.summary,
        files: [...new Set(f.fix!.edits!.map((e) => e.file))],
      });
    } else {
      result.remaining.push({
        code: f.code,
        detail: f.detail,
        instruction: f.fix?.task?.instruction,
        files: f.fix?.task?.files,
        evidence: f.fix?.task?.evidence,
      });
    }
  }

  if (opts.apply && writes.size > 0) {
    const { writeFileAtomic } = await import('./installSkill');
    for (const [file, contents] of writes) writeFileAtomic(join(dir, file), contents);
  }

  if (opts.json) {
    console.log(JSON.stringify({ ...result, applied_to_disk: Boolean(opts.apply) }, null, 2));
  } else {
    console.log(formatFix(result, diff, Boolean(opts.apply)));
  }

  if (opts.exitCode && result.remaining.length > 0) process.exitCode = 1;
}

export function formatFix(result: FixResult, diff: string, applied: boolean): string {
  const out: string[] = [];
  if (result.applied.length === 0 && result.remaining.length === 0) {
    return `Nothing to fix in ${result.root}: no upgrade in this plan renames a symbol this code references.`;
  }

  if (result.applied.length > 0) {
    out.push(
      applied
        ? `Wrote ${result.files.length} file(s) in ${result.root}:`
        : `Would write ${result.files.length} file(s) in ${result.root} (pass --apply):`,
    );
    for (const a of result.applied) out.push(`  ${a.summary} — ${a.files.join(', ')}`);
    if (!applied && diff) out.push('', diff.trimEnd());
  }

  if (result.remaining.length > 0) {
    out.push('', `${result.remaining.length} change(s) lurq will not make for you:`);
    for (const r of result.remaining) {
      out.push(`  ${r.detail}`);
      if (r.instruction) out.push(`    do: ${r.instruction}`);
      if (r.files?.length) out.push(`    in: ${r.files.join(', ')}`);
      // The candidates are the reason this line is worth reading: without them
      // the next step is a guess from training data, which is the failure lurq
      // exists to prevent.
      for (const e of r.evidence ?? []) out.push(`    use: ${e}`);
    }
  }

  if (result.refused.length > 0) {
    out.push('', 'Proven renames left alone:');
    for (const r of result.refused) out.push(`  ${r.symbol}: ${r.reason}`);
  }
  return out.join('\n');
}
