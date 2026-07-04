/**
 * Shared domain types and the v1 category taxonomy (§8.3).
 * These are the stable contracts the rest of the system builds on.
 */

/** Category taxonomy for the JS/TS web stack (§8.3). `other` is the fallback. */
export const CATEGORIES = [
  'framework',
  'meta-framework',
  'state-management',
  'routing',
  'orm',
  'database-client',
  'ui-component-library',
  'styling',
  'forms',
  'validation',
  'data-fetching',
  'http-client',
  'auth',
  'testing',
  'build-tool',
  'bundler',
  'linting',
  'date-time',
  'animation',
  'charts',
  'i18n',
  'utility',
  'other',
] as const;

export type Category = (typeof CATEGORIES)[number];

export function isCategory(value: string): value is Category {
  return (CATEGORIES as readonly string[]).includes(value);
}

/** Provenance of a package's stored category (§2A). `curated` comes from the
 *  seed file or a manual arg; `inferred` was assigned automatically at ingest
 *  and is safe for a later curation pass to override. */
export type CategorySource = 'curated' | 'inferred';

/** How a candidate entered the discovery queue (§2B). `dependency-graph` and
 *  `recent` are the long-tail channels; `category-search` is keyword-seeded;
 *  `reactive` is an on-demand query that wasn't tracked yet. */
export type DiscoverySource = 'dependency-graph' | 'category-search' | 'recent' | 'reactive';

/** Lifecycle of a discovery-queue candidate (§2B). */
export type DiscoveryStatus = 'pending' | 'ingested' | 'rejected';

/**
 * Categories for which bundle size is meaningful and Bundlephobia is consulted
 * (§9.5). Backend-only categories get a null bundle size, and their efficiency
 * weight is redistributed (§10, see scoring).
 */
export const FRONTEND_CATEGORIES = [
  'ui-component-library',
  'styling',
  'state-management',
  'forms',
  'validation',
  'data-fetching',
  'charts',
  'animation',
  'date-time',
  'utility',
] as const;

export function isFrontendCategory(category: Category | null | undefined): boolean {
  return category != null && (FRONTEND_CATEGORIES as readonly string[]).includes(category);
}

/**
 * Evidence-trustworthiness label, independent of the numeric score (§10, §1).
 * Two-dimensional: `proven`/`emerging` are adoption ladders; `promising` is
 * adoption-independent (high intrinsic quality, new package).
 */
export type Confidence = 'proven' | 'emerging' | 'promising' | 'unproven';

export type Runtime = 'browser' | 'node' | 'both';

/** Result of co-installing two package versions in the sandbox (compat matrix). */
export type CompatStatus = 'compatible' | 'conflict';

/** Coarse post-install result an agent reports back via `report_outcome` — never
 *  source code, just whether the recommended package installed / compiled /
 *  passed tests, or failed. Feeds the recommendation→outcome flywheel (§3.1). */
export type BuildSignal = 'installed' | 'compiled' | 'tests_passed' | 'failed';

/** Sandbox verdict surfaced to agents: did this version actually install + load? */
export interface BuildVerified {
  version: string;
  installed: boolean;
  loaded: boolean | null;
  driver: string;
  ranAt: string;
}

/** A map of dependency/peer/engine name → semver range (from a manifest). */
export type DependencyRanges = Record<string, string>;
/** `peerDependenciesMeta`: per-peer flags, notably `{ optional: true }`. */
export type PeerMeta = Record<string, { optional?: boolean }>;

/** One incompatibility found across a set of packages. */
export interface CompatConflict {
  /** Where the conflict came from. `peer-deps`/`engines` are Tier-1 (metadata,
   *  instant, deterministic); `sandbox` is Tier-2 (empirical co-install). */
  source: 'peer-deps' | 'engines' | 'sandbox';
  /** The packages involved in the conflict. */
  packages: string[];
  detail: string;
}

/**
 * `compat` output: whole-architecture compatibility for a set of packages.
 * Tier-1 peer-dependency/engine analysis + any Tier-2 sandbox conflicts.
 */
export interface CompatOutput {
  packages: string[];
  overall: 'compatible' | 'conflict' | 'unknown';
  conflicts: CompatConflict[];
  /** Packages lurq has no compatibility metadata for (counted toward `unknown`). */
  unverified: string[];
  /** The exact members the check ran over, name + resolved version. Versions are
   *  always surfaced here, and the structure is stable for later scraping. */
  checked: { name: string; version: string | null }[];
}

export type AdvisorySeverity = 'critical' | 'high' | 'moderate' | 'low' | 'info';

export interface Advisory {
  id: string;
  severity: AdvisorySeverity;
  summary: string;
}

/** Sub-scores composing the health score (§10). `efficiency` is null when not
 *  size-based (backend categories) — its weight is redistributed.
 *  `quality` (§1) is a standalone, adoption-independent axis — it does NOT feed
 *  the health composite; it blends with health only at ranking time. Null when
 *  no manifest signals were available. */
export interface ScoreBreakdown {
  maintenance: number;
  adoption: number;
  reliability: number;
  efficiency: number | null;
  quality: number | null;
}

/**
 * Structured usage guide generated at ingest (product refinement: lurq explains,
 * not just ranks). Grounded in the package README/description — never fabricated.
 * Exact current API specifics are deferred to Context7 via `context7Hint`.
 */
export interface UsageGuide {
  whatItIs: string;
  whenToUse: string;
  whenNotToUse?: string;
  whereItFits: string;
  howToWireIn?: string;
  context7Hint?: string;
}

/** A single recommendation candidate (§12.3.1). Intentionally compact. */
export interface Candidate {
  name: string;
  category: Category | null;
  healthScore: number;
  qualityScore: number | null;
  confidence: Confidence;
  why: string;
  latestVersion: string | null;
  weeklyDownloads: number | null;
  lastReleaseAt: string | null;
  repoUrl: string | null;
}

/** Full evidence read for one package (§12.3.2). */
export interface EvaluateOutput {
  dataAsOf: string;
  stale?: boolean;
  name: string;
  category: Category | null;
  healthScore: number;
  qualityScore: number | null;
  confidence: Confidence;
  scoreBreakdown: ScoreBreakdown;
  latestVersion: string | null;
  lastReleaseAt: string | null;
  weeklyDownloads: number | null;
  downloadGrowth90d: number | null;
  scorecard: number | null;
  bundleMinGzipKb: number | null;
  deprecated: boolean;
  archived: boolean;
  advisories: Advisory[];
  summary: string | null;
  usageGuide: UsageGuide | null;
  repoUrl: string | null;
  /** Latest sandbox verdict for this package, if one has been run. */
  buildVerified?: BuildVerified | null;
}

/** `verify` output (§12.3.4). */
/** Supply-chain risk gate: high = review before installing (see security/risk). */
export type RiskLevel = 'low' | 'medium' | 'high';

export interface VerifyOutput {
  exists: boolean;
  tracked: boolean;
  deprecated: boolean;
  archived: boolean;
  latestVersion: string | null;
  weeklyDownloads: number | null;
  riskFlags: string[];
  /** Overall supply-chain risk, rolled up from riskFlags. */
  risk: RiskLevel;
  /** Suspected typosquat target — a popular package this name closely mimics. */
  typosquatOf: string | null;
  confidence: Confidence | null;
  advisoryCount: number;
}
