/**
 * `lurq upgrade-plan` and the plan half of `lurq check-upgrade`.
 *
 * These run where the code is — a laptop or a CI runner — so they read manifests
 * from disk and ask the hosted index only "what changed between these versions".
 * Nothing about the source is sent: the request body is the dependency block
 * that is already public in any published package.json.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { parseManifest } from '../github/manifests';
import type { RepoManifest } from '../github/types';
import { fetchUpgradePlan, type RemoteOptions, type RemotePlan, type RemoteUpgrade } from './remote';

/** Directories never worth walking for a workspace manifest. */
const SKIP = new Set(['node_modules', '.git', 'dist', 'build', '.next', 'coverage', 'vendor']);

/** Matches the server-side scan cap so local and CI plans agree. */
const MAX_MANIFESTS = 25;
const MAX_DEPTH = 4;

/**
 * Find every `package.json` under `dir`, root first.
 *
 * Mirrors `manifestPaths` (which reads a GitHub tree) for the local filesystem.
 * The two deliberately apply the same rules — a plan computed in CI must match
 * what the dashboard reported, or the two views of one repo disagree.
 */
export function findManifests(dir: string, maxDepth = MAX_DEPTH): string[] {
  const found: string[] = [];

  const walk = (current: string, depth: number): void => {
    if (found.length >= MAX_MANIFESTS || depth > maxDepth) return;
    let entries: string[];
    try {
      entries = readdirSync(current);
    } catch {
      return; // unreadable directory: skip rather than abort the whole scan
    }
    if (entries.includes('package.json')) found.push(join(current, 'package.json'));
    for (const entry of entries) {
      if (SKIP.has(entry) || entry.startsWith('.')) continue;
      const child = join(current, entry);
      try {
        if (statSync(child).isDirectory()) walk(child, depth + 1);
      } catch {
        /* symlink loop or permission error — skip this entry */
      }
    }
  };

  walk(dir, 0);
  return found;
}

/** Read and parse every manifest under `dir`. */
export function readManifests(dir: string): RepoManifest[] {
  const out: RepoManifest[] = [];
  for (const file of findManifests(dir)) {
    try {
      const parsed = parseManifest(
        relative(dir, file) || 'package.json',
        JSON.parse(readFileSync(file, 'utf8')),
      );
      if (parsed) out.push(parsed);
    } catch {
      /* malformed manifest: the others still have real drift worth planning */
    }
  }
  return out;
}

/** Merge every manifest's ranges into one dependency map for the plan request. */
export function mergedDeps(manifests: RepoManifest[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const manifest of manifests) {
    for (const [name, range] of Object.entries(manifest.deps)) {
      out[name] ??= range;
    }
  }
  return out;
}

export interface UpgradePlanResult extends RemotePlan {
  manifests: number;
  deps: number;
}

export async function buildUpgradePlan(
  dir: string,
  opts: RemoteOptions = {},
): Promise<UpgradePlanResult> {
  const manifests = readManifests(dir);
  const deps = mergedDeps(manifests);
  if (Object.keys(deps).length === 0) {
    throw new Error(`No package.json with dependencies found under ${dir}`);
  }
  const plan = await fetchUpgradePlan(deps, opts);
  return { ...plan, manifests: manifests.length, deps: Object.keys(deps).length };
}

const VERDICT_LABEL: Record<RemoteUpgrade['verdict'], string> = {
  'removes-exports': 'REMOVES ',
  'arity-changed': 'ARITY   ',
  clean: 'CLEAN   ',
  unknown: 'UNKNOWN ',
};

/** One-screen summary. Same shape as formatUpgradeReport so the two read alike. */
export function formatUpgradePlan(plan: UpgradePlanResult): string {
  const out: string[] = [
    `lurq — upgrade plan (${plan.deps} dependencies across ${plan.manifests} manifest(s))`,
    '',
  ];

  if (plan.upgrades.length === 0) {
    out.push('Everything lurq tracks is already on its latest release.');
  }

  for (const upgrade of plan.upgrades) {
    out.push(
      `${VERDICT_LABEL[upgrade.verdict]}  ${upgrade.package}  ${upgrade.fromVersion} → ${upgrade.toVersion}` +
        (upgrade.advisories ? `  (${upgrade.advisories} advisory)` : ''),
    );
    if (upgrade.removed.length) {
      out.push(`  removes ${upgrade.removed.length}: ${upgrade.removed.slice(0, 8).join(', ')}`);
    }
    for (const change of upgrade.arityChanged.slice(0, 5)) {
      out.push(`  arity ${change.path}: ${change.from ?? '?'} → ${change.to ?? '?'}`);
    }
    if (upgrade.inconclusive) out.push(`  ${upgrade.inconclusive}`);
  }

  // Never let a partial plan read as a complete one.
  const caveats: string[] = [];
  if (plan.untracked > 0) caveats.push(`${plan.untracked} dependency(ies) not in the lurq index`);
  if (plan.omitted > 0) caveats.push(`${plan.omitted} further upgrade(s) not shown`);
  if (plan.pending > 0) caveats.push(`${plan.pending} awaiting surface extraction`);
  if (caveats.length) out.push('', `NOT COVERED: ${caveats.join('; ')}.`);

  return out.join('\n');
}
