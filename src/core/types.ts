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

/** Evidence-trustworthiness label, independent of the numeric score (§10). */
export type Confidence = 'proven' | 'emerging' | 'unproven';

export type Runtime = 'browser' | 'node' | 'both';

export type AdvisorySeverity = 'critical' | 'high' | 'moderate' | 'low' | 'info';

export interface Advisory {
  id: string;
  severity: AdvisorySeverity;
  summary: string;
}

/** Sub-scores composing the health score (§10). `efficiency` is null when not
 *  size-based (backend categories) — its weight is redistributed. */
export interface ScoreBreakdown {
  maintenance: number;
  adoption: number;
  reliability: number;
  efficiency: number | null;
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
  confidence: Confidence;
  scoreBreakdown: ScoreBreakdown;
  latestVersion: string | null;
  lastReleaseAt: string | null;
  weeklyDownloads: number | null;
  downloadGrowth90d: number | null;
  dependentsCount: number | null;
  scorecard: number | null;
  bundleMinGzipKb: number | null;
  deprecated: boolean;
  archived: boolean;
  advisories: Advisory[];
  summary: string | null;
  usageGuide: UsageGuide | null;
  repoUrl: string | null;
}

/** `verify` output (§12.3.4). */
export interface VerifyOutput {
  exists: boolean;
  tracked: boolean;
  deprecated: boolean;
  archived: boolean;
  latestVersion: string | null;
  weeklyDownloads: number | null;
  riskFlags: string[];
  confidence: Confidence | null;
  advisoryCount: number;
}
