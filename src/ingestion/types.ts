/**
 * Normalized shapes returned by each source client. The pipeline (M3) merges
 * these into a `packages` row. Every field is nullable: any source can fail or
 * omit a signal, and that must degrade gracefully (§17), never crash ingestion.
 */
import type { Advisory } from '../core/types';

/** One published version of a package and when it shipped (from the packument). */
export interface VersionInfo {
  version: string;
  publishedAt: Date | null;
}

export interface NpmRegistryData {
  name: string;
  description: string | null;
  latestVersion: string | null;
  license: string | null;
  homepage: string | null;
  /** Parsed `{ owner, repo }` from the repository field, if it's a GitHub URL. */
  repo: { owner: string; repo: string } | null;
  repoUrl: string | null;
  firstPublishedAt: Date | null;
  lastReleaseAt: Date | null;
  deprecated: boolean;
  maintainersCount: number | null;
  /** Raw README text if available (for summary/usage-guide generation, §9.6). */
  readme: string | null;
  /** package.json `keywords` (used for categorize-on-ingest, §2A). */
  keywords: string[];
  // ── Intrinsic-quality signals (§1), all from the latest version manifest ──
  /** Ships TypeScript types (`types`/`typings` field present, or an `@types/*` name). */
  hasTypes: boolean;
  /** A real `scripts.test` (not the npm "no test specified" placeholder). */
  hasTestScript: boolean;
  /** Count of direct runtime dependencies (fewer → leaner → higher quality). */
  directDependenciesCount: number | null;
  /** npm provenance / signed publish attestation present on the latest dist. */
  hasProvenance: boolean;
  /** Declares preinstall/install/postinstall hooks — code that runs at install
   *  time, the primary supply-chain execution vector. */
  hasInstallScripts: boolean;
  /** Full published-version timeline (version + publish date), newest first. */
  versionTimeline: VersionInfo[];
}

export interface NpmDownloadsData {
  weeklyDownloads: number | null;
  /** Fractional change: last-30d avg vs prior-30d avg (§9.2). */
  downloadGrowth90d: number | null;
}

export interface GithubRepoData {
  stars: number | null;
  openIssues: number | null;
  closedIssues: number | null;
  archived: boolean;
  lastReleaseAt: Date | null;
  /** Count of releases within the last 12 months (cadence signal, §10). */
  releasesLast12mo: number | null;
}

export interface DepsDevData {
  /** OpenSSF Scorecard, 0–10 (§9.4). */
  scorecard: number | null;
  advisories: Advisory[];
}

export interface BundlephobiaData {
  /** Minified + gzipped size in KB (§9.5). Null for backend-only packages. */
  bundleMinGzipKb: number | null;
}

/** Everything gathered for one package before scoring (M3). */
export interface RawPackageSignals {
  name: string;
  registry: NpmRegistryData | null;
  downloads: NpmDownloadsData | null;
  github: GithubRepoData | null;
  depsDev: DepsDevData | null;
  bundle: BundlephobiaData | null;
  /** Per-source failures, recorded but non-fatal. */
  errors: { source: string; message: string }[];
}
