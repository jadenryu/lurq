/**
 * The half of an upgrade `lurq fix` was leaving behind.
 *
 * Rewriting `parse` to `parseCookie` across the source and leaving
 * `"cookie": "^1.1.1"` in package.json produces a tree that does not build: the
 * code now calls an export the installed version does not have, and the next
 * `npm install` faithfully reinstalls the old one. The manifest bump is part of
 * performing the upgrade, not a tidy-up after it.
 *
 * The question asked of each declared range is "does the target version satisfy
 * it?", not "does it contain the old version". `^1.0.0` with 1.1.1 installed is
 * the ordinary case, and a string match would miss it entirely.
 *
 * Only a range this can rewrite without judgement is rewritten: an optional `^`
 * or `~` and one exact version. Comparators, unions, wildcards and tags
 * (`>=1 <3`, `1 || 2`, `1.x`, `latest`) are refused and reported, because
 * "what did the author mean by this range" is a question, and a question is not
 * a deterministic fix.
 *
 * Offsets come from the TypeScript compiler's JSON parser, which is already a
 * dependency and survives into the published package. It gives exact positions
 * and tolerates the trailing commas and comments a hand-written manifest may
 * carry — where JSON.parse would either lose every byte of formatting or refuse
 * the file outright.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import ts from 'typescript';
import semver from 'semver';
import type { UpgradeTarget } from '../surface/upgrade';
import type { Edit, Finding } from './types';

/** Dependency blocks worth bumping. `peerDependencies` is deliberately absent:
 *  a peer range states what a library ACCEPTS from its consumer, and widening
 *  that is a publishing decision, not an upgrade step. */
const BLOCKS = ['dependencies', 'devDependencies', 'optionalDependencies'] as const;

/** `^1.2.3`, `~1.2.3`, `1.2.3` — and nothing else. */
const SIMPLE_RANGE = /^(\^|~)?(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)$/;

export interface DeclaredRange {
  block: string;
  range: string;
  /** Offsets of the range TEXT, inside its quotes. */
  start: number;
  end: number;
}

/**
 * Where a package's version range sits in one manifest's text.
 *
 * Returns the first block that declares it. A package in both `dependencies`
 * and `devDependencies` is a mistake in the manifest, and bumping one of the
 * two is not this module's business to adjudicate.
 */
export function declaredRange(text: string, pkg: string): DeclaredRange | null {
  const sf = ts.parseJsonText('package.json', text);
  const root = sf.statements[0]?.expression;
  if (!root || !ts.isObjectLiteralExpression(root)) return null;

  const propNamed = (obj: ts.ObjectLiteralExpression, name: string) =>
    obj.properties.find(
      (p): p is ts.PropertyAssignment =>
        ts.isPropertyAssignment(p) && ts.isStringLiteral(p.name) && p.name.text === name,
    );

  for (const block of BLOCKS) {
    const blockProp = propNamed(root, block);
    if (!blockProp || !ts.isObjectLiteralExpression(blockProp.initializer)) continue;
    const dep = propNamed(blockProp.initializer, pkg);
    if (!dep || !ts.isStringLiteral(dep.initializer)) continue;
    const node = dep.initializer;
    // Inside the quotes: the edit replaces the range, never the JSON syntax.
    return { block, range: node.text, start: node.getStart(sf) + 1, end: node.getEnd() - 1 };
  }
  return null;
}

export interface RangeDecision {
  /** No edit needed: the declared range already admits the target. */
  satisfied?: boolean;
  edit?: Edit;
  refusedBecause?: string;
}

/** What to do about one declared range, given the version being moved to. */
export function decideRange(file: string, found: DeclaredRange, toVersion: string): RangeDecision {
  if (!semver.valid(toVersion)) {
    return { refusedBecause: `${toVersion} is not an exact version` };
  }
  // Already open enough. Common when a caret range spans the whole upgrade, and
  // rewriting it anyway would narrow what the project accepts for no reason.
  if (semver.validRange(found.range) && semver.satisfies(toVersion, found.range)) {
    return { satisfied: true };
  }
  const simple = SIMPLE_RANGE.exec(found.range);
  if (!simple) {
    return {
      refusedBecause: `"${found.range}" is not a plain ^, ~ or exact range, so what it should become is a judgement`,
    };
  }
  const prefix = simple[1] ?? '';
  return {
    edit: { file, start: found.start, end: found.end, text: `${prefix}${toVersion}`, was: found.range },
  };
}

export interface ManifestPlan {
  findings: Finding[];
  /** Ranges left alone, and why. */
  refused: { package: string; file: string; reason: string }[];
}

export interface ManifestOptions {
  /**
   * Manifest paths relative to root. Defaults to the root manifest alone: a
   * monorepo walk belongs to whoever already knows the project layout, and
   * reaching back into the CLI from here would drag the remote client into
   * this module's graph for nothing.
   */
  files?: string[];
  /** Injectable for tests; reads a manifest's text. Null when unreadable. */
  read?: (file: string) => string | null;
}

/**
 * Findings for the manifests an upgrade leaves stale.
 *
 * One finding per package, carrying edits across every manifest that declares
 * it — a monorepo declares the same dependency in several workspaces, and
 * bumping one of them is the same broken tree with extra steps.
 */
export function manifestFindings(
  root: string,
  targets: UpgradeTarget[],
  opts: ManifestOptions = {},
): ManifestPlan {
  const files = opts.files ?? ['package.json'];
  const read =
    opts.read ??
    ((file: string) => {
      try {
        return readFileSync(join(root, file), 'utf8');
      } catch {
        return null;
      }
    });

  const texts = new Map<string, string>();
  for (const file of files) {
    const text = read(file);
    if (text !== null) texts.set(file, text);
  }

  const findings: Finding[] = [];
  const refused: ManifestPlan['refused'] = [];

  for (const target of targets) {
    const edits: Edit[] = [];
    const bumped: string[] = [];
    for (const [file, text] of texts) {
      const found = declaredRange(text, target.package);
      if (!found) continue;
      const decision = decideRange(file, found, target.toVersion);
      if (decision.edit) {
        edits.push(decision.edit);
        bumped.push(file);
      } else if (decision.refusedBecause) {
        refused.push({ package: target.package, file, reason: decision.refusedBecause });
      }
    }

    if (edits.length === 0) continue;
    findings.push({
      domain: 'package',
      code: `outdated-range:${target.package}`,
      // Blocking: with the source rewritten and the range still pinning the old
      // major, the next install puts the old version back under new code.
      severity: 'blocking',
      detail: `${target.package} is declared at a range that excludes ${target.toVersion} in ${bumped.length} manifest(s): ${bumped.join(', ')}`,
      file: bumped[0],
      evidence: `upgrading ${target.package} ${target.fromVersion} → ${target.toVersion}`,
      fix: {
        summary: `bump ${target.package} to ${target.toVersion} in ${bumped.length} manifest(s)`,
        edits,
        // Installing is the user's call; the type check is what proves the tree agrees.
        verify: ['typecheck'],
      },
    });
  }

  return { findings, refused };
}
