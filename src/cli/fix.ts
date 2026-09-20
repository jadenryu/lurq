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
import { readFileSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { manifestFindings } from '../fix/manifest';
import { deterministic, editsByFile, applyEdits, type Finding } from '../fix/types';
import { unifiedDiff } from '../fix/diff';
import type { UpgradeTarget } from '../surface/upgrade';
import {
  SCAN_LIMIT,
  fixableTargets,
  parseUpgradeSpec,
  planUpgrades,
  type FixableSplit,
} from './checkUpgrade';

export interface FixOpts {
  /** Targets from `upgrade-plan --json`. */
  plan?: string;
  /** `pkg@from..to`, repeatable. */
  upgrade?: string[];
  /** For the derived plan only; the fix itself never talks to us. */
  url?: string;
  apiKey?: string;
  /** Which repo's policy governs the derived plan. Defaults to $GITHUB_REPOSITORY. */
  repo?: string;
  /** Write the files. Off by default: the default is a diff. */
  apply?: boolean;
  json?: boolean;
  /** Exit 1 when something is left for a human or an agent to do. */
  exitCode?: boolean;
  /**
   * Most packages to fix in one run. The blast radius: a deterministic edit is
   * safer than a model's, but a diff touching forty packages is still a review
   * nobody finishes.
   */
  max?: number;
  /**
   * Write SARIF here, for GitHub code scanning. That is where a finding gets a
   * lifecycle lurq would otherwise have to build: dedup, assignment, and
   * closing itself when it stops reproducing.
   */
  sarif?: string;
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
  /** Why a proven rename was not written here, and in which file. */
  refused: { symbol: string; file?: string; reason: string }[];
  /**
   * Upgrades never attempted, and why. Kept apart from `refused`: "tried and
   * would not" and "did not try" are different answers, and merging them put
   * a skipped multi-major upgrade under a heading about proven renames.
   */
  skipped: { package: string; reason: string }[];
}

/**
 * No `--plan` and no `--upgrade`: work out what moved, instead of making the
 * user name versions they would have had to look up first.
 *
 * This is the only part of `fix` that needs the hosted API, because the index is
 * what knows a newer version exists. Everything after it reads the two npm
 * tarballs locally, so the offline contract still holds: `--upgrade pkg@from..to`
 * needs no key, and the refusal here says so rather than surfacing a bare 401
 * from a command whose whole point is working without us.
 */
async function derivePlanTargets(dir: string, opts: FixOpts): Promise<FixableSplit> {
  const { buildUpgradePlan } = await import('./upgradePlan');
  try {
    const plan = await buildUpgradePlan(dir, {
      url: opts.url,
      apiKey: opts.apiKey,
      repo: opts.repo,
    });
    // The same rules the --plan path uses, not a second reading of them.
    return fixableTargets(plan.upgrades, opts.max);
  } catch (err) {
    // Matched by name rather than instanceof: remote.ts stays a lazy import, so
    // there is no guarantee both sides hold the same class object.
    if (err instanceof Error && err.name === 'MissingKeyError') {
      throw new Error(
        `${err.message}\n\nOr skip the lookup: \`lurq fix --upgrade pkg@from..to\` reads both versions straight from npm and needs no key.`,
      );
    }
    throw err;
  }
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
export function stage(
  root: string,
  findings: Finding[],
): { writes: Map<string, string>; diff: string } {
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

  // Naming versions was the last decision this command still demanded, and it
  // was the one the user could not answer without looking something up first.
  const asked = Boolean(opts.plan) || (opts.upgrade?.length ?? 0) > 0;
  // `--upgrade` is the user naming a version pair themselves, so it is taken at
  // face value; a plan is filtered, because a plan carries what the upgrade
  // would actually involve.
  const split = asked
    ? {
        ...fixableTargets(opts.plan ? planUpgrades(opts.plan) : [], opts.max),
        named: (opts.upgrade ?? []).map(parseUpgradeSpec),
      }
    : { ...(await derivePlanTargets(dir, opts)), named: [] as UpgradeTarget[] };
  const targets = [...split.targets, ...split.named];
  const skipped = split.skipped;

  if (targets.length === 0) {
    const empty: FixResult = {
      root: dir,
      files: [],
      applied: [],
      remaining: [],
      refused: [],
      skipped,
    };
    // Silence here would be a lie when every upgrade was skipped: "nothing to
    // fix" and "nothing I am willing to fix" are different sentences.
    const nothing = skipped.length
      ? [
          `Nothing attempted in ${dir}. ${skipped.length} upgrade(s) deliberately not tried:`,
          ...skippedLines(skipped),
        ].join('\n')
      : asked
        ? 'Nothing to check.'
        : 'Nothing to fix: every dependency is current, or the repo policy holds the rest.';
    console.log(opts.json ? JSON.stringify(empty, null, 2) : nothing);
    return;
  }

  // No type check: a rename is a fact about the runtime surface, and the type
  // check is the slowest part of `check-upgrade`. `lurq check-upgrade` is still
  // the gate; this is the writer.
  const refs = scanReferences(dir, { limit: SCAN_LIMIT });
  const report = await checkUpgrade(targets, refs, { rootDir: dir });
  const renames = renamePlan(report);

  // The manifest is part of performing the upgrade, not a tidy-up after it:
  // rewritten imports plus a range that still pins the old major is a tree that
  // does not build, and the next install puts the old version back.
  const { findManifests } = await import('./upgradePlan');
  const manifests = manifestFindings(dir, targets, {
    files: findManifests(dir).map((abs) => relative(dir, abs) || 'package.json'),
  });

  const findings = [...renames.findings, ...manifests.findings];
  const refused = [
    ...renames.refused,
    ...manifests.refused.map((r) => ({ symbol: r.package, file: r.file, reason: r.reason })),
  ];

  const result: FixResult = {
    root: dir,
    files: [],
    applied: [],
    remaining: [],
    refused: refused.map((r) => ({ symbol: r.symbol, file: r.file, reason: r.reason })),
    skipped,
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

  if (opts.sarif) {
    const { toSarif } = await import('../fix/sarif');
    const { VERSION } = await import('../core/constants');
    const sarif = toSarif(findings, {
      version: VERSION,
      // Read from disk rather than reusing the staged text: regions must
      // describe the file as it is, not as it would be after the fix.
      read: (file) => {
        try {
          return readFileSync(join(dir, file), 'utf8');
        } catch {
          return null;
        }
      },
    });
    writeFileSync(opts.sarif, `${JSON.stringify(sarif, null, 2)}\n`, 'utf8');
    console.error(`wrote ${opts.sarif}`);
  }

  if (opts.json) {
    console.log(JSON.stringify({ ...result, applied_to_disk: Boolean(opts.apply) }, null, 2));
  } else {
    console.log(formatFix(result, diff, Boolean(opts.apply)));
  }

  if (opts.exitCode && result.remaining.length > 0) process.exitCode = 1;
}

/** One line per skip, shared by the empty case and the full report. */
function skippedLines(skipped: { package: string; reason: string }[]): string[] {
  return skipped.map((s) => `  ${s.package}: ${s.reason}`);
}

export function formatFix(result: FixResult, diff: string, applied: boolean): string {
  const out: string[] = [];
  if (result.applied.length === 0 && result.remaining.length === 0) {
    // Both halves, because both were checked: a stale message that names only
    // renames reads as "the manifest was not looked at".
    return `Nothing to fix in ${result.root}: no upgrade in this plan renames a symbol this code references, and every declared range already admits its target.`;
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

  if (result.skipped.length > 0) {
    out.push('', `${result.skipped.length} upgrade(s) deliberately not attempted:`);
    out.push(...skippedLines(result.skipped));
  }

  if (result.refused.length > 0) {
    out.push('', 'Proven renames left alone:');
    // The reason names the symbol, so the file is the useful prefix when there is one.
    for (const r of result.refused) out.push(`  ${r.file ?? r.symbol}: ${r.reason}`);
  }
  return out.join('\n');
}
