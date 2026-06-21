/**
 * All scoring weights and thresholds in one tunable file (§10).
 * Changing the model means editing this file only.
 */

/** Composite health-score weights. Must sum to 1.0. */
export const HEALTH_WEIGHTS = {
  maintenance: 0.35,
  adoption: 0.3,
  reliability: 0.25,
  efficiency: 0.1,
} as const;

/** Maintenance sub-score component weights (of the available components). */
export const MAINTENANCE_WEIGHTS = {
  recency: 0.5,
  cadence: 0.25,
  closeRatio: 0.25,
} as const;

export const MAINTENANCE = {
  /** A release within this many days scores full recency. */
  freshDays: 30,
  /** Recency decays linearly to 0 by this many days (~24 months). */
  staleDays: 730,
  /** Releases/12mo at or above this cap full cadence. */
  cadenceCap: 12,
  /** deprecated/archived hard-cap maintenance at this value. */
  deadCap: 15,
} as const;

export const ADOPTION = {
  /** log10(weekly downloads): this maps to 0. */
  downloadsLogMin: 1, // 10/wk
  /** log10(weekly downloads): this maps to 100. */
  downloadsLogMax: 7, // 10M/wk
  /** log10(stars) that maps to 100. */
  starsLogMax: 5, // 100k stars
  /** Weight of the stars component when available (downloads gets the rest). */
  starsWeight: 0.2,
  /** Growth bonus: growth fraction × this, clamped to ±cap. */
  growthMultiplier: 30,
  growthBonusCap: 20,
} as const;

export const RELIABILITY = {
  /** Used when no Scorecard is available (unknown security posture). */
  neutralWhenUnknown: 50,
  /** Advisory penalties by severity. */
  penalty: {
    critical: 40,
    high: 20,
    moderate: 8,
    low: 3,
    info: 0,
  },
} as const;

export const EFFICIENCY = {
  /** Bundle size at the category median maps to this score; smaller → higher. */
  medianScore: 50,
} as const;

/** Confidence-label thresholds (§10). */
export const CONFIDENCE = {
  proven: {
    minWeeklyDownloads: 100_000,
    minAgeMonths: 12,
    maxLastReleaseMonths: 6,
  },
  emerging: {
    minWeeklyDownloads: 5_000,
    strongGrowth: 0.5,
    maxLastReleaseMonths: 9,
  },
} as const;
