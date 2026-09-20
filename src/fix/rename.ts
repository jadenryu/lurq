/**
 * The one upgrade break a rule can fix without a model: an export that was
 * renamed, where the package itself proves the rename.
 *
 * `diff.renamed` is not a name-similarity guess. It is set when, at the SOURCE
 * version, the removed name and a survivor were exported from the same
 * declaration, and the target version still exports that survivor. In practice
 * that is the deprecate-then-remove shape: a release adds `newName` alongside
 * `oldName` on one declaration, and a later major drops `oldName`. Then the
 * package itself states the correspondence and the rewrite is mechanical.
 *
 * It is deliberately narrow, and whether a real upgrade qualifies turns on the
 * exact versions. Measured, not assumed: cookie 1.1.1 → 2.0.1 DOES prove
 * `parse` → `parseCookie`, because 1.1.x shipped both names from the same
 * declaration. cookie 1.0.2 → 2.0.0 does not, because `parseCookie` did not
 * exist yet at 1.0.2 — same package, same rename, and only one of the two pairs
 * is provable.
 *
 * Everything unprovable becomes a brief for the agent carrying the target's
 * real exports, never an edit. Guessing from name similarity is how a fixer
 * writes a confident wrong call site, which is worse than the error it
 * replaced.
 *
 * Refusals are per FILE, not per package: the files that can be rewritten are,
 * and the ones that cannot come back as a brief naming them. A rename proven
 * across nine files is not abandoned because the tenth shadows the name.
 *
 * Refused, every time:
 *   - more than one survivor: two candidates is a choice, and a choice is not
 *     a deterministic fix. It becomes an agent task instead.
 *   - a file where the local name is declared twice (`shadowed`): uses cannot
 *     be attributed to the import, so rewriting them would rename the wrong
 *     thing.
 *   - references reached as a namespace, a default, or a member of either: the
 *     export name is not what appears at the call site.
 *   - type-only references: erased before runtime, and the type checker will
 *     name them anyway.
 *   - a subpath import when the rename was proven at the package root: a
 *     subpath has its own surface.
 *   - anything missing offsets, which means the scanner did not follow it.
 *
 * An aliased import needs ONE edit: `{ oldName as local }` becomes
 * `{ newName as local }` and every call site still reads `local`.
 * A bare import needs the import and every use.
 */
import type { BreakingFinding, UpgradeReport } from '../surface/upgrade';
import type { SymbolReference } from '../surface/references';
import type { Edit, Finding } from './types';

/** Reference kinds whose recorded symbol IS the name written in the code. */
const REWRITABLE = new Set(['named', 'destructured']);

/**
 * Replacement candidates carried in a brief. `newExports` is already ranked and
 * capped upstream; this keeps a wide package from burying the instruction in a
 * list no model will read carefully.
 */
const CANDIDATE_LIMIT = 20;

export interface RenameOptions {
  /** Package root specifier check: a subpath keeps its own surface. */
  packageName: string;
}

interface Refusal {
  symbol: string;
  to: string[];
  /** The file that refused it. Absent when the refusal is about the whole project. */
  file?: string;
  reason: string;
}

export interface RenamePlan {
  findings: Finding[];
  /** Renames that could not be done deterministically, and why. */
  refused: Refusal[];
}

function isRootSpecifier(ref: SymbolReference, pkg: string): boolean {
  return ref.specifier === pkg;
}

interface RefusedFile {
  file: string;
  reason: string;
}

/**
 * Edits for one proven rename, per file, plus the files that refused it.
 *
 * Grouped by file because a refusal is a fact about ONE file. This used to
 * return on the first bad reference, which threw away the edits already
 * collected for every other file — so one shadowed local in the tenth file
 * cancelled a rename that was proven and safe in the nine before it. The tool
 * refused work it had already done, and the user got "will not rewrite it
 * here" for a project it could have fixed almost all of.
 */
function editsFor(
  refs: SymbolReference[],
  to: string,
  pkg: string,
): { edits: Edit[]; files: string[]; refusedFiles: RefusedFile[] } {
  const byFile = new Map<string, SymbolReference[]>();
  for (const ref of refs) {
    const list = byFile.get(ref.file);
    if (list) list.push(ref);
    else byFile.set(ref.file, [ref]);
  }

  const edits: Edit[] = [];
  const files: string[] = [];
  const refusedFiles: RefusedFile[] = [];

  for (const [file, fileRefs] of byFile) {
    const fileEdits: Edit[] = [];
    let refused: string | null = null;

    for (const ref of fileRefs) {
      if (!isRootSpecifier(ref, pkg)) continue; // a subpath has its own surface
      if (ref.via === 'type-only') continue; // erased before runtime
      if (!REWRITABLE.has(ref.via)) {
        refused = `reached as ${ref.via}, where the export name is not what the code writes`;
        break;
      }
      if (ref.shadowed) {
        refused = `${ref.local ?? ref.symbol} is declared more than once`;
        break;
      }
      if (ref.nameStart === undefined || ref.nameEnd === undefined) {
        refused = 'no recorded position for the import';
        break;
      }

      // `was` is the identifier the scanner read at that range: the exported
      // name at the import, the local name at a use. It is what makes a stale
      // offset a refusal rather than a rename written into unrelated code.
      fileEdits.push({ file, start: ref.nameStart, end: ref.nameEnd, text: to, was: ref.symbol });

      // An aliased import keeps its local name, so the uses are already correct.
      if (ref.aliased) continue;
      const local = ref.local ?? ref.symbol;
      for (const use of ref.calls ?? []) {
        if (use.start === undefined || use.end === undefined) {
          refused = `a use of ${local} has no recorded position`;
          break;
        }
        fileEdits.push({ file, start: use.start, end: use.end, text: to, was: local });
      }
      if (refused) break;
    }

    if (refused) refusedFiles.push({ file, reason: refused });
    else if (fileEdits.length > 0) {
      files.push(file);
      edits.push(...fileEdits);
    }
  }

  return { edits, files, refusedFiles };
}

/** Deduplicate identical ranges: one identifier can be recorded by two claims. */
function dedupe(edits: Edit[]): Edit[] {
  const seen = new Set<string>();
  return edits.filter((e) => {
    const key = `${e.file}:${e.start}-${e.end}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** Findings for one package's breaking report. */
export function renameFindings(breaking: BreakingFinding, opts: RenameOptions): RenamePlan {
  const findings: Finding[] = [];
  const refused: Refusal[] = [];
  const version = `${breaking.package}@${breaking.fromVersion ?? '?'} → ${breaking.toVersion ?? '?'}`;

  for (const removed of breaking.symbolsRemoved) {
    const to = removed.renamedTo ?? [];
    const code = `renamed-export:${breaking.package}:${removed.symbol}`;
    const files = [...new Set(removed.refs.map((r) => r.file))];

    if (to.length === 0) {
      // No same-declaration proof, which is the common case. cookie 1.0.2 → 2.0.0
      // is one: `parse` is gone and `parseCookie` is the replacement, but
      // `parseCookie` did not exist at 1.0.2, so nothing in the package states
      // the correspondence. (From 1.1.1 it does — see the header.)
      //
      // Returning nothing here is the failure that makes a fixer useless — the
      // upgrade is still blocking and the user is still stuck. So it becomes a
      // brief instead, carrying the target version's own new exports. That list
      // is the one thing the agent doing the rewrite cannot look up: it runs
      // with no network, and its training data is the stale source this exists
      // to correct.
      if (files.length === 0 || breaking.newExports.length === 0) continue;
      const candidates = breaking.newExports.slice(0, CANDIDATE_LIMIT);
      findings.push({
        domain: 'package',
        code: `removed-export:${breaking.package}:${removed.symbol}`,
        severity: breaking.severity,
        detail: `${removed.symbol} does not exist in ${version}, and the package does not say what replaced it`,
        evidence: `${breaking.toVersion} exports that ${breaking.fromVersion} did not: ${candidates.map((e) => e.symbol).join(', ')}`,
        fix: {
          summary: `replace ${removed.symbol} using the exports ${breaking.toVersion} actually ships`,
          task: {
            instruction: `${removed.symbol} was removed from ${breaking.package} in ${breaking.toVersion}. Rewrite each use with the export that matches what the code does with it. Do not invent a name: use one from the list below, or report that none fits.`,
            files,
            evidence: candidates.map(
              (e) => `${e.symbol}: ${e.kind}${e.arity === null ? '' : `, ${e.arity} parameter(s)`}`,
            ),
          },
          verify: ['typecheck', 'tests'],
        },
      });
      continue;
    }

    if (to.length > 1) {
      refused.push({
        symbol: removed.symbol,
        to,
        reason: 'more than one surviving name; a choice, not a rewrite',
      });
      findings.push({
        domain: 'package',
        code,
        severity: breaking.severity,
        detail: `${removed.symbol} was removed in ${version}; the package exports ${to.join(' and ')} from the same declaration, so which one replaces it is a judgement`,
        evidence: `${version}: same-declaration survivors ${to.join(', ')}`,
        fix: {
          summary: `replace ${removed.symbol} with whichever of ${to.join(' or ')} the code means`,
          task: {
            instruction: `${removed.symbol} no longer exists in ${breaking.package} ${breaking.toVersion ?? 'the target version'}. Replace each use with ${to.join(' or ')}, whichever matches how the value is used.`,
            files: [...new Set(removed.refs.map((r) => r.file))],
            evidence: [`${breaking.toVersion ?? 'target'} exports: ${to.join(', ')}`],
          },
          verify: ['typecheck', 'tests'],
        },
      });
      continue;
    }

    const target = to[0]!;
    const proof = `${version}: ${removed.symbol} and ${target} were exported from one declaration at ${breaking.fromVersion ?? 'the source version'}`;
    const manualTask = (taskFiles: string[], extra: string[] = []) => ({
      instruction: `Rename ${removed.symbol} to ${target} where it is imported from ${breaking.package}.`,
      files: taskFiles,
      evidence: [`${target} exists at ${breaking.toVersion ?? 'the target version'}`, ...extra],
    });

    const {
      edits: collected,
      files: editedFiles,
      refusedFiles,
    } = editsFor(removed.refs, target, opts.packageName);
    const edits = dedupe(collected);

    // The two halves are independent: a project can have most of its files
    // rewritten and get a brief for the rest, which is the whole point of
    // refusing per file. They carry different codes so acknowledging one does
    // not silence the other.
    if (edits.length > 0) {
      findings.push({
        domain: 'package',
        code,
        severity: breaking.severity,
        detail: `${removed.symbol} was renamed to ${target} in ${version}: ${edits.length} occurrence(s) in ${editedFiles.length} file(s)`,
        file: editedFiles[0],
        evidence: `${proof}, and ${target} still exists`,
        fix: {
          summary: `rename ${removed.symbol} to ${target}`,
          edits,
          verify: ['typecheck', 'tests'],
        },
      });
    }

    if (refusedFiles.length > 0) {
      for (const r of refusedFiles)
        refused.push({ symbol: removed.symbol, to, file: r.file, reason: r.reason });
      findings.push({
        domain: 'package',
        code: `${code}:manual`,
        severity: breaking.severity,
        detail: `${removed.symbol} was renamed to ${target} in ${version}, but ${refusedFiles.length} file(s) need a person: ${refusedFiles
          .map((r) => `${r.file} (${r.reason})`)
          .join('; ')}`,
        file: refusedFiles[0]!.file,
        evidence: proof,
        fix: {
          summary: `rename ${removed.symbol} to ${target} in ${refusedFiles.length} file(s) lurq will not touch`,
          // The reasons are already in `detail`; repeating them as evidence put
          // them under the "use one of these" label meant for real exports.
          task: manualTask(refusedFiles.map((r) => r.file)),
          verify: ['typecheck', 'tests'],
        },
      });
    }

    if (edits.length === 0 && refusedFiles.length === 0) {
      const reason = 'nothing in this project references it at the package root';
      refused.push({ symbol: removed.symbol, to, reason });
      findings.push({
        domain: 'package',
        code,
        severity: breaking.severity,
        detail: `${removed.symbol} was renamed to ${target} in ${version}, but lurq will not rewrite it here: ${reason}`,
        evidence: proof,
        fix: {
          summary: `rename ${removed.symbol} to ${target} by hand`,
          task: manualTask([...new Set(removed.refs.map((r) => r.file))]),
          verify: ['typecheck', 'tests'],
        },
      });
    }
  }

  return { findings, refused };
}

/** Findings across a whole `check-upgrade` report. */
export function renamePlan(report: UpgradeReport): RenamePlan {
  const findings: Finding[] = [];
  const refused: Refusal[] = [];
  for (const breaking of report.breaking) {
    const plan = renameFindings(breaking, { packageName: breaking.package });
    findings.push(...plan.findings);
    refused.push(...plan.refused);
  }
  return { findings, refused };
}
