/**
 * Repo inventory + manifest reading.
 *
 * Everything here reads exactly two things from a repository: the list of repos
 * the installation covers, and the dependency blocks of its `package.json`
 * files. File *names* come along in the tree listing — that is how the package
 * manager is detected — but no lockfile, source file, or history is ever read.
 * That is not a limitation we plan to lift server-side: the code-reading half of
 * the product runs in the user's own CI.
 */
import { installationGet } from './app';
import { detectInstallCommand } from './workflow';
import { REPO_MANIFEST_CAP, type RepoManifest } from './types';
import { logger } from '../core/logger';
import { HttpError } from '../core/http';

export interface InstallationRepo {
  fullName: string;
  defaultBranch: string;
  isPrivate: boolean;
  /** Last push, ISO-8601, or null when GitHub omits it. Ordering only — never stored. */
  pushedAt: string | null;
}

interface ReposResponse {
  repositories?: {
    full_name: string;
    default_branch: string;
    private: boolean;
    pushed_at?: string | null;
  }[];
}

/** GitHub caps `per_page` at 100 for this endpoint. */
const PAGE_SIZE = 100;
/** Stop paginating here. 20 pages = 2000 repos; past that the connect flow needs
 *  repo selection in the UI, not a bigger loop. */
const MAX_PAGES = 20;

/** Every repo the user granted the installation access to. */
export async function listInstallationRepos(
  installationId: number,
): Promise<InstallationRepo[]> {
  const out: InstallationRepo[] = [];
  for (let page = 1; page <= MAX_PAGES; page++) {
    const data = await installationGet<ReposResponse>(
      installationId,
      `/installation/repositories?per_page=${PAGE_SIZE}&page=${page}`,
    );
    const batch = data.repositories ?? [];
    for (const repo of batch) {
      out.push({
        fullName: repo.full_name,
        defaultBranch: repo.default_branch,
        isPrivate: repo.private,
        pushedAt: repo.pushed_at ?? null,
      });
    }
    if (batch.length < PAGE_SIZE) break;
  }
  return out;
}

interface TreeResponse {
  tree?: { path: string; type: string }[];
  truncated?: boolean;
}

interface ContentsResponse {
  content?: string;
  encoding?: string;
}

/**
 * Paths of every `package.json` in the repo, root first.
 *
 * One recursive tree call instead of guessing workspace globs: it costs the same
 * as reading the root manifest alone, and it is the only way to find the real
 * layout of a monorepo without parsing `workspaces` patterns (which can be
 * globs, arrays, or a pnpm YAML file we would then also have to read).
 */
export function manifestPaths(tree: { path: string; type: string }[]): string[] {
  return tree
    .filter(
      (node) =>
        node.type === 'blob' &&
        (node.path === 'package.json' || node.path.endsWith('/package.json')) &&
        // A committed node_modules is rare but real, and its manifests are not
        // this project's dependencies — counting them would invent drift.
        !node.path.split('/').includes('node_modules'),
    )
    .sort((a, b) => a.path.split('/').length - b.path.split('/').length)
    .map((node) => node.path);
}

/** Merge `dependencies` + `devDependencies`, dropping non-registry specifiers. */
export function parseManifest(path: string, json: unknown): RepoManifest | null {
  if (!json || typeof json !== 'object') return null;
  const pkg = json as Record<string, unknown>;
  const deps: Record<string, string> = {};
  for (const block of ['dependencies', 'devDependencies']) {
    const entry = pkg[block];
    if (!entry || typeof entry !== 'object') continue;
    for (const [name, range] of Object.entries(entry as Record<string, unknown>)) {
      if (typeof range !== 'string') continue;
      // `file:`, `link:`, `workspace:`, `git+…`, and bare URLs never resolve to a
      // registry version, so they have no drift to report. Including them would
      // pad `depsDeclared` with rows that can only ever read "unknown".
      if (/^(file|link|workspace|git|github|https?|portal):/i.test(range)) continue;
      if (range.includes('/') && !range.startsWith('>') && !range.startsWith('<')) continue;
      deps[name] = range;
    }
  }
  return Object.keys(deps).length > 0 ? { path, deps } : null;
}

export interface ManifestScan {
  manifests: RepoManifest[];
  /**
   * True when the repository has no commits at all.
   *
   * Distinct from `manifests: []`, which means "there are commits, none of them
   * declare dependencies". Both are successful scans, but only one of them is
   * something the user might want to act on, and telling a person their repo has
   * "0 dependencies" when it actually has no code yet is a confusing answer to a
   * question they did not ask.
   */
  empty: boolean;
  /** Install command for the repo's actual package manager, from its lockfile. */
  installCommand: string;
  /** True when the repo has more manifests than we read, or GitHub truncated the
   *  tree. The dashboard says "partial" rather than reporting a low count as
   *  complete — an undercount that looks authoritative is worse than a caveat. */
  partial: boolean;
}

/** Read every dependency block in a repo. */
export async function fetchManifests(
  installationId: number,
  fullName: string,
  branch: string,
): Promise<ManifestScan> {
  let tree: TreeResponse;
  try {
    tree = await installationGet<TreeResponse>(
      installationId,
      `/repos/${fullName}/git/trees/${encodeURIComponent(branch)}?recursive=1`,
    );
  } catch (err) {
    // GitHub answers 409 for a repository with no commits. That is a fact about
    // the repo, not a failure of ours — a freshly created repo someone connected
    // before pushing anything is the common case. Treating it as an error left
    // `last_scan_error` set on a perfectly healthy repo, and the dashboard shows
    // that next to fresh numbers as though something were currently broken.
    if (err instanceof HttpError && err.status === 409) {
      return { manifests: [], installCommand: detectInstallCommand([]), partial: false, empty: true };
    }
    throw err;
  }
  const nodes = tree.tree ?? [];
  const allPaths = manifestPaths(nodes);
  // Root-level lockfiles only: a nested one belongs to a workspace, not to the
  // command that installs the whole repo.
  const lockfiles = nodes.filter((n) => !n.path.includes('/')).map((n) => n.path);
  const paths = allPaths.slice(0, REPO_MANIFEST_CAP);

  const manifests: RepoManifest[] = [];
  for (const path of paths) {
    try {
      const res = await installationGet<ContentsResponse>(
        installationId,
        `/repos/${fullName}/contents/${path.split('/').map(encodeURIComponent).join('/')}?ref=${encodeURIComponent(branch)}`,
      );
      if (!res.content || res.encoding !== 'base64') continue;
      const parsed = parseManifest(
        path,
        JSON.parse(Buffer.from(res.content, 'base64').toString('utf8')),
      );
      if (parsed) manifests.push(parsed);
    } catch (err) {
      // One malformed or unreadable manifest must not fail the whole repo scan —
      // the other workspaces still have real drift worth reporting.
      logger.debug(`manifest read failed for ${fullName}/${path}: ${(err as Error).message}`);
    }
  }

  return {
    manifests,
    installCommand: detectInstallCommand(lockfiles),
    partial: Boolean(tree.truncated) || allPaths.length > paths.length,
    empty: false,
  };
}
