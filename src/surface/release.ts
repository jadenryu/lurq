/**
 * Release check — semver stated vs semver earned.
 *
 * Every other surface consumer in this tree points the diff *outward*: what did
 * a dependency remove, and does our code touch it. This points it at the author:
 * compare the working tree's built surface against the last version this package
 * published, and say whether the version number about to be tagged is honest.
 *
 * Nothing new is measured. `diffSurfaces` already answers "what disappeared
 * between two surfaces"; the only addition is that one side comes from a local
 * directory instead of a registry tarball, and that the answer is mapped onto a
 * semver level. A package author is the one person who can prevent a breaking
 * change from shipping as a patch, and today nothing tells them they are about
 * to — `npm publish` will happily tag a deleted export as 1.2.4.
 *
 * Runs entirely on the author's machine against a registry tarball: no API key,
 * no database, nothing about their code leaves the process.
 */
import semver from 'semver';
import { diffSurfaces, type ArityChange } from './diff';
import { fetchAndExtract } from './fetch';
import { readManifest } from './resolve';
import type { ExtractedSurface } from './types';

/** Semver levels, ordered. `patch` is the floor: publishing needs *some* bump. */
export type Bump = 'patch' | 'minor' | 'major';
const RANK: Record<Bump, number> = { patch: 0, minor: 1, major: 2 };

export interface ReleaseCheck {
  package: string;
  /** The published version compared against — the baseline. */
  publishedVersion: string | null;
  /** The version in the working tree's package.json. */
  localVersion: string | null;
  /** The bump the version field claims, or null when it is not a bump at all. */
  declared: Bump | null;
  /** The smallest bump the surface change actually justifies. */
  required: Bump;
  verdict: 'ok' | 'understated' | 'inconclusive';
  /** Runtime exports present in the published version and gone locally. */
  removed: string[];
  /** Exports whose parameter count changed — a break for positional callers. */
  arityChanged: ArityChange[];
  /** Removed types. Breaks `tsc` for consumers, not `node`; still a major. */
  typeOnlyRemoved: string[];
  added: string[];
  /** Set when no verdict could be reached. Never read the arrays if present. */
  inconclusive?: string;
}

/**
 * The bump the two version strings describe, by their numeric components.
 *
 * Deliberately not `semver.diff`, which answers with `premajor`/`prepatch`/
 * `prerelease` for anything carrying a tag — `2.0.0-rc.1` declares a major and
 * has to be read as one, or every release candidate reports as understated.
 * Returns null when the local version is not ahead, which is its own defect
 * worth naming rather than folding into `patch`.
 */
function declaredBump(from: string, to: string): Bump | null {
  if (!semver.gt(to, from)) return null;
  if (semver.major(to) !== semver.major(from)) return 'major';
  if (semver.minor(to) !== semver.minor(from)) return 'minor';
  return 'patch';
}

/**
 * Does `declared` cover `required`?
 *
 * Below 1.0.0 the channels shift down one: the ecosystem reads `0.x` minor as
 * the breaking channel (npm's own caret range encodes this — `^0.2.0` refuses
 * `0.3.0`), so a minor bump is a legitimate way to ship a break at 0.x. Applying
 * the 1.x rule there would flag most pre-1.0 releases and get the check muted.
 */
function covers(declared: Bump, required: Bump, baselineMajor: number): boolean {
  if (baselineMajor === 0 && required === 'major') return RANK[declared] >= RANK.minor;
  return RANK[declared] >= RANK[required];
}

/**
 * The whole judgement, as a pure function of two version strings and the shape
 * of the diff. Split out from `checkRelease` because everything else in that
 * function is I/O — this is the part with rules in it, and the part worth a test
 * that does not need a registry.
 */
export function releaseVerdict(
  publishedVersion: string,
  localVersion: string,
  diff: {
    removed: unknown[];
    arityChanged: unknown[];
    typeOnlyRemoved: unknown[];
    added: unknown[];
  },
): Pick<ReleaseCheck, 'declared' | 'required' | 'verdict'> {
  const required: Bump =
    diff.removed.length || diff.arityChanged.length || diff.typeOnlyRemoved.length
      ? 'major'
      : diff.added.length
        ? 'minor'
        : 'patch';
  const declared = declaredBump(publishedVersion, localVersion);
  const verdict =
    declared !== null && covers(declared, required, semver.major(publishedVersion))
      ? 'ok'
      : 'understated';
  return { declared, required, verdict };
}

const inconclusive = (
  base: Pick<ReleaseCheck, 'package' | 'publishedVersion' | 'localVersion'>,
  reason: string,
): ReleaseCheck => ({
  ...base,
  declared: null,
  required: 'patch',
  verdict: 'inconclusive',
  removed: [],
  arityChanged: [],
  typeOnlyRemoved: [],
  added: [],
  inconclusive: reason,
});

/**
 * Compare a working tree against its last published version.
 *
 * `extractSurface` reads the entry point the manifest declares, which for a
 * built package is `dist/` — so an unbuilt tree yields no entry and returns
 * inconclusive rather than an empty surface. That distinction is load-bearing:
 * an empty extraction compared against a real one would report every export as
 * removed, which is the §6.4.2 defect this codebase already refuses elsewhere.
 */
export async function checkRelease(
  dir: string,
  opts: { against?: string; fetchImpl?: typeof fetch } = {},
): Promise<ReleaseCheck> {
  const manifest = readManifest(dir);
  const name = manifest?.name;
  const base = {
    package: name ?? dir,
    publishedVersion: null,
    localVersion: manifest?.version ?? null,
  };
  if (!name) return inconclusive(base, `no readable package.json in ${dir}`);
  if (!manifest.version) return inconclusive(base, 'package.json has no version field');

  const { extractSurface } = await import('./extract');
  const local: ExtractedSurface = extractSurface(dir, { manifest });
  if (local.undeclaredReason) {
    return inconclusive(base, `${local.undeclaredReason} — build the package first`);
  }

  const published = await fetchAndExtract(name, opts.against ?? 'latest', {
    fetchImpl: opts.fetchImpl,
  });
  if (!published) {
    return inconclusive(base, `${name} has no published version to compare against`);
  }

  const withVersion = { ...base, publishedVersion: published.resolvedVersion };
  const diff = diffSurfaces(published.surface, local);
  if (diff.inconclusive) return inconclusive(withVersion, diff.inconclusive);

  return {
    ...withVersion,
    ...releaseVerdict(published.resolvedVersion, manifest.version, diff),
    removed: diff.removed.map((s) => s.path),
    arityChanged: diff.arityChanged,
    typeOnlyRemoved: diff.typeOnlyRemoved.map((s) => s.path),
    added: diff.added.map((s) => s.path),
  };
}

/** Symbols listed before the report starts summarising. */
const LIST_CAP = 12;

const list = (label: string, items: string[]): string[] => {
  if (!items.length) return [];
  const shown = items.slice(0, LIST_CAP);
  const more = items.length - shown.length;
  return [
    `  ${label} (${items.length}):`,
    ...shown.map((s) => `    · ${s}`),
    ...(more > 0 ? [`    … ${more} more`] : []),
  ];
};

export function formatReleaseCheck(c: ReleaseCheck): string {
  const out = [`lurq, release check — ${c.package}`, ''];

  if (c.verdict === 'inconclusive') {
    out.push(`INCONCLUSIVE  ${c.inconclusive}`, '', 'No verdict. This is not a pass.');
    return out.join('\n');
  }

  const from = c.publishedVersion ?? '?';
  const to = c.localVersion ?? '?';
  out.push(
    c.verdict === 'ok'
      ? c.declared === c.required
        ? `OK          ${from} → ${to} is a ${c.declared}, which is what this API change needs.`
        : `OK          ${from} → ${to} is a ${c.declared}; this API change only needed a ${c.required}.`
      : c.declared === null
        ? `UNDERSTATED  ${to} is not ahead of the published ${from}.`
        : `UNDERSTATED  ${from} → ${to} is tagged ${c.declared}, but this API change is a ${c.required}.`,
    '',
  );

  out.push(...list('Removed exports', c.removed));
  if (c.arityChanged.length) {
    out.push(`  Parameter count changed (${c.arityChanged.length}):`);
    for (const a of c.arityChanged.slice(0, LIST_CAP)) {
      out.push(`    · ${a.path}  ${a.from} → ${a.to}`);
    }
  }
  out.push(...list('Removed types (breaks tsc, not node)', c.typeOnlyRemoved));
  out.push(...list('Added exports', c.added));

  if (!c.removed.length && !c.arityChanged.length && !c.typeOnlyRemoved.length && !c.added.length) {
    out.push('  No change to the exported surface.');
  }
  return out.join('\n');
}
