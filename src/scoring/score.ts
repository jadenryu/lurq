/**
 * Scoring & confidence model (§10). All functions are pure and take an explicit
 * `now` for deterministic testing.
 *
 * Two-pass design: maintenance / adoption / reliability / confidence depend only
 * on a single package, so they're computed in pass 1. Efficiency needs the
 * category median bundle size (§10), so it — and the composite health score —
 * are computed in pass 2 once all packages are collected.
 */
import type { Advisory, Category, Confidence, ScoreBreakdown } from '../core/types';
import { isFrontendCategory } from '../core/types';
import type { RawPackageSignals } from '../ingestion/types';
import {
  ADOPTION,
  CONFIDENCE,
  EFFICIENCY,
  HEALTH_WEIGHTS,
  MAINTENANCE,
  MAINTENANCE_WEIGHTS,
  RELIABILITY,
} from './weights';

export interface ScoringInput {
  weeklyDownloads: number | null;
  downloadGrowth90d: number | null;
  stars: number | null;
  dependentsCount: number | null;
  firstPublishedAt: Date | null;
  lastReleaseAt: Date | null;
  releasesLast12mo: number | null;
  openIssues: number | null;
  closedIssues: number | null;
  scorecard: number | null;
  advisories: Advisory[];
  deprecated: boolean;
  archived: boolean;
  bundleMinGzipKb: number | null;
  category: Category | null;
}

const DAY_MS = 24 * 60 * 60 * 1000;
const MONTH_MS = 30 * DAY_MS;

const clamp = (n: number, lo = 0, hi = 100): number => Math.max(lo, Math.min(hi, n));
const daysSince = (date: Date | null, now: Date): number | null =>
  date ? (now.getTime() - date.getTime()) / DAY_MS : null;
const monthsSince = (date: Date | null, now: Date): number | null =>
  date ? (now.getTime() - date.getTime()) / MONTH_MS : null;

/** Build a ScoringInput from collected raw signals. */
export function toScoringInput(signals: RawPackageSignals, category: Category | null): ScoringInput {
  const { registry, downloads, github, depsDev, bundle } = signals;
  return {
    weeklyDownloads: downloads?.weeklyDownloads ?? null,
    downloadGrowth90d: downloads?.downloadGrowth90d ?? null,
    stars: github?.stars ?? null,
    dependentsCount: null, // not collected in v1 (see spec R1 note)
    firstPublishedAt: registry?.firstPublishedAt ?? null,
    lastReleaseAt: github?.lastReleaseAt ?? registry?.lastReleaseAt ?? null,
    releasesLast12mo: github?.releasesLast12mo ?? null,
    openIssues: github?.openIssues ?? null,
    closedIssues: github?.closedIssues ?? null,
    scorecard: depsDev?.scorecard ?? null,
    advisories: depsDev?.advisories ?? [],
    deprecated: registry?.deprecated ?? false,
    archived: github?.archived ?? false,
    bundleMinGzipKb: bundle?.bundleMinGzipKb ?? null,
    category,
  };
}

// ── Maintenance ─────────────────────────────────────────────────────────────

export function computeMaintenance(input: ScoringInput, now: Date): number {
  if (input.deprecated || input.archived) return MAINTENANCE.deadCap;

  const components: { value: number; weight: number }[] = [];

  const days = daysSince(input.lastReleaseAt, now);
  if (days !== null) {
    const recency =
      days <= MAINTENANCE.freshDays
        ? 100
        : clamp((100 * (MAINTENANCE.staleDays - days)) / (MAINTENANCE.staleDays - MAINTENANCE.freshDays));
    components.push({ value: recency, weight: MAINTENANCE_WEIGHTS.recency });
  }

  if (input.releasesLast12mo !== null) {
    const cadence = clamp((Math.min(input.releasesLast12mo, MAINTENANCE.cadenceCap) / MAINTENANCE.cadenceCap) * 100);
    components.push({ value: cadence, weight: MAINTENANCE_WEIGHTS.cadence });
  }

  if (input.openIssues !== null && input.closedIssues !== null) {
    const total = input.openIssues + input.closedIssues;
    if (total > 0) {
      components.push({ value: (input.closedIssues / total) * 100, weight: MAINTENANCE_WEIGHTS.closeRatio });
    }
  }

  return weightedAverage(components);
}

// ── Adoption ────────────────────────────────────────────────────────────────

export function computeAdoption(input: ScoringInput): number {
  const dl = input.weeklyDownloads ?? 0;
  const downloadsScore = clamp(
    ((Math.log10(Math.max(dl, 1)) - ADOPTION.downloadsLogMin) /
      (ADOPTION.downloadsLogMax - ADOPTION.downloadsLogMin)) *
      100,
  );

  let base = downloadsScore;
  if (input.stars !== null) {
    const starsScore = clamp((Math.log10(Math.max(input.stars, 1)) / ADOPTION.starsLogMax) * 100);
    base = (1 - ADOPTION.starsWeight) * downloadsScore + ADOPTION.starsWeight * starsScore;
  }

  if (input.downloadGrowth90d !== null) {
    const bonus = clamp(
      input.downloadGrowth90d * ADOPTION.growthMultiplier,
      -ADOPTION.growthBonusCap,
      ADOPTION.growthBonusCap,
    );
    base += bonus;
  }

  return clamp(base);
}

// ── Reliability ─────────────────────────────────────────────────────────────

export function computeReliability(input: ScoringInput): number {
  const base = input.scorecard !== null ? input.scorecard * 10 : RELIABILITY.neutralWhenUnknown;
  const penalty = input.advisories.reduce(
    (sum, adv) => sum + (RELIABILITY.penalty[adv.severity] ?? 0),
    0,
  );
  return clamp(base - penalty);
}

// ── Efficiency (pass 2 — needs the category median) ─────────────────────────

/**
 * Efficiency for frontend categories: smaller-than-median bundle → higher score
 * (median maps to 50). Returns null for backend categories / missing data; the
 * null signals the composite to redistribute the efficiency weight (§10, R1).
 */
export function computeEfficiency(
  bundleMinGzipKb: number | null,
  category: Category | null,
  categoryMedian: number | null,
): number | null {
  if (!isFrontendCategory(category) || bundleMinGzipKb === null || !categoryMedian || categoryMedian <= 0) {
    return null;
  }
  const ratio = bundleMinGzipKb / categoryMedian;
  return clamp(100 - ratio * EFFICIENCY.medianScore);
}

// ── Composite ───────────────────────────────────────────────────────────────

/** Compose the health score, redistributing efficiency's weight when null. */
export function computeHealthScore(breakdown: ScoreBreakdown): number {
  const { maintenance, adoption, reliability, efficiency } = breakdown;
  if (efficiency === null) {
    const w = HEALTH_WEIGHTS;
    const denom = w.maintenance + w.adoption + w.reliability;
    return Math.round(
      (w.maintenance * maintenance + w.adoption * adoption + w.reliability * reliability) / denom,
    );
  }
  return Math.round(
    HEALTH_WEIGHTS.maintenance * maintenance +
      HEALTH_WEIGHTS.adoption * adoption +
      HEALTH_WEIGHTS.reliability * reliability +
      HEALTH_WEIGHTS.efficiency * efficiency,
  );
}

// ── Confidence ──────────────────────────────────────────────────────────────

export function hasCriticalOrHighAdvisory(advisories: Advisory[]): boolean {
  return advisories.some((a) => a.severity === 'critical' || a.severity === 'high');
}

export function computeConfidence(input: ScoringInput, now: Date): Confidence {
  const dl = input.weeklyDownloads ?? 0;
  const ageMonths = monthsSince(input.firstPublishedAt, now);
  const lastReleaseMonths = monthsSince(input.lastReleaseAt, now);
  const growth = input.downloadGrowth90d ?? 0;

  const provenReleaseOk =
    lastReleaseMonths !== null && lastReleaseMonths <= CONFIDENCE.proven.maxLastReleaseMonths;
  const provenAgeOk = ageMonths !== null && ageMonths >= CONFIDENCE.proven.minAgeMonths;

  if (
    dl >= CONFIDENCE.proven.minWeeklyDownloads &&
    provenAgeOk &&
    provenReleaseOk &&
    !hasCriticalOrHighAdvisory(input.advisories) &&
    !input.deprecated &&
    !input.archived
  ) {
    return 'proven';
  }

  const emergingReleaseOk =
    lastReleaseMonths !== null && lastReleaseMonths <= CONFIDENCE.emerging.maxLastReleaseMonths;
  const emergingAdoptionOk =
    dl >= CONFIDENCE.emerging.minWeeklyDownloads || growth >= CONFIDENCE.emerging.strongGrowth;

  if (emergingAdoptionOk && emergingReleaseOk && !input.deprecated && !input.archived) {
    return 'emerging';
  }

  return 'unproven';
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function weightedAverage(components: { value: number; weight: number }[]): number {
  if (components.length === 0) return 0;
  const totalWeight = components.reduce((s, c) => s + c.weight, 0);
  if (totalWeight === 0) return 0;
  return Math.round(components.reduce((s, c) => s + c.value * c.weight, 0) / totalWeight);
}

/** Median of a numeric list, or null if empty. */
export function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1]! + sorted[mid]!) / 2 : sorted[mid]!;
}
