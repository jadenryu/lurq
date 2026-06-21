/**
 * Gather all source signals for one package (§9.7 steps 1–5). Fault-isolated:
 * each source is wrapped so a single failure records an error and degrades that
 * signal to null rather than failing the package (§17).
 */
import { logger } from '../core/logger';
import type { Category } from '../core/types';
import { fetchBundlephobia } from './sources/bundlephobia';
import { fetchDepsDev } from './sources/depsDev';
import { fetchGithubRepo } from './sources/github';
import { fetchDownloadGrowth, fetchWeeklyDownloads } from './sources/npmDownloads';
import { fetchNpmRegistry } from './sources/npmRegistry';
import type { NpmDownloadsData, RawPackageSignals } from './types';

export interface CollectDeps {
  githubToken?: string;
  fetchImpl?: typeof fetch;
  /**
   * Pre-fetched weekly downloads (from the bulk endpoint). When provided (even
   * as null), the per-package weekly fetch is skipped — avoiding the downloads
   * API's harsh rate limits during a full sync.
   */
  prefetchedWeekly?: number | null;
}

async function attempt<T>(
  source: string,
  errors: { source: string; message: string }[],
  fn: () => Promise<T>,
): Promise<T | null> {
  try {
    return await fn();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    errors.push({ source, message });
    logger.debug(`[${source}] ${message}`);
    return null;
  }
}

export async function collectSignals(
  name: string,
  category: Category | null,
  deps: CollectDeps = {},
): Promise<RawPackageSignals> {
  const { githubToken, fetchImpl } = deps;
  const errors: { source: string; message: string }[] = [];

  // 1. Registry first — it provides the repo + version the other sources need.
  const registry = await attempt('npm-registry', errors, () => fetchNpmRegistry(name, fetchImpl));

  const repo = registry?.repo ?? null;
  const version = registry?.latestVersion ?? null;

  // 2–5. The rest run concurrently.
  const [downloads, github, depsDev, bundle] = await Promise.all([
    attempt('npm-downloads', errors, async (): Promise<NpmDownloadsData> => {
      const weeklyDownloads =
        deps.prefetchedWeekly !== undefined
          ? deps.prefetchedWeekly
          : await fetchWeeklyDownloads(name, fetchImpl);
      const downloadGrowth90d = await fetchDownloadGrowth(name, fetchImpl);
      return { weeklyDownloads, downloadGrowth90d };
    }),
    repo && githubToken
      ? attempt('github', errors, () => fetchGithubRepo(repo.owner, repo.repo, githubToken, fetchImpl))
      : Promise.resolve(null),
    attempt('deps-dev', errors, () => fetchDepsDev(name, version, repo, fetchImpl)),
    attempt('bundlephobia', errors, () => fetchBundlephobia(name, category, fetchImpl)),
  ]);

  return { name, registry, downloads, github, depsDev, bundle, errors };
}
