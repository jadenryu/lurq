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

/**
 * Health↔Quality blend for the default composite sort (§1). Quality is a
 * standalone, adoption-independent axis — NOT a member of HEALTH_WEIGHTS. The
 * two only blend here, for ranking/sort: composite = (1−λ)·health + λ·quality.
 * λ is the single most impactful knob `edit-weights` exposes.
 */
export const COMPOSITE = {
  lambda: 0.35,
} as const;

/**
 * Quality sub-score component weights (of the *available* components — missing
 * signals are dropped, not zeroed, via weightedAverage). All inputs are
 * adoption-independent: they measure how well-built a package is, not how many
 * people use it.
 */
export const QUALITY_WEIGHTS = {
  types: 0.25,
  tests: 0.2,
  docs: 0.2,
  changelog: 0.1,
  deps: 0.1,
  license: 0.1,
  provenance: 0.05,
} as const;

export const QUALITY = {
  /** README at/above this many characters scores full marks on doc length. */
  docsFullLengthChars: 1200,
  /** Direct-dependency count at/above this scores 0 on the deps component (log-scaled). */
  depsLogMax: 30,
  /** A license string present but not OSI-recognized scores this (vs 100 / 0). */
  licenseUnrecognizedScore: 60,
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

/** Proactive-discovery crawler tuning (§2B). The gate is quality-only — downloads
 *  are deliberately excluded so merit, not popularity, decides what graduates. */
export const DISCOVERY = {
  /** A queued candidate must clear this quality pre-score to graduate to ingest. */
  minPreScore: 45,
  /** Max candidates fully ingested per crawler run (cost bound). */
  perRunCap: 25,
  /** npm-search hits to pull per category keyword. */
  searchSizePerCategory: 10,
  /** Max dependency-graph neighbors to enqueue per tracked seed. */
  graphNeighborsPerSeed: 20,
} as const;

// ── Tunable weight model: defaults ← user-config ← env (§4) ──────────────────

import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { projectWeightsPath, userWeightsPath } from '../core/paths';

/** The user-tunable slice of the model (§4). Sub-component weights and
 *  thresholds stay fixed; these are the knobs `edit-weights` exposes. */
export interface WeightConfig {
  health: {
    maintenance: number;
    adoption: number;
    reliability: number;
    efficiency: number;
  };
  /** Health↔Quality blend λ for the default sort composite. */
  composite: { lambda: number };
}

export const DEFAULT_WEIGHTS: WeightConfig = {
  health: { ...HEALTH_WEIGHTS },
  composite: { ...COMPOSITE },
};

export type WeightSource = 'defaults' | 'user-config' | 'project-config';

/** Where overrides are read from, if anywhere — for `lurq weights` to report. */
export function activeWeightsPath(): { path: string; source: WeightSource } | null {
  if (existsSync(projectWeightsPath())) return { path: projectWeightsPath(), source: 'project-config' };
  if (existsSync(userWeightsPath())) return { path: userWeightsPath(), source: 'user-config' };
  return null;
}

let cachedWeights: WeightConfig | undefined;

/**
 * Resolve the effective weight model: defaults, overlaid by a config file
 * (project-local wins over user-level), overlaid by env (`LURQ_COMPOSITE_LAMBDA`).
 * Always returns a validated, sum-to-1 health block. Memoized; call
 * `resetWeightsCache()` after a write or in tests.
 */
export function loadWeights(): WeightConfig {
  if (cachedWeights) return cachedWeights;

  let merged: WeightConfig = structuredClone(DEFAULT_WEIGHTS);
  const active = activeWeightsPath();
  if (active) {
    try {
      const fromFile = JSON.parse(readFileSync(active.path, 'utf8')) as Partial<WeightConfig>;
      merged = mergeWeights(merged, fromFile);
    } catch {
      // A corrupt override file must never break scoring — fall back to defaults.
    }
  }

  const envLambda = process.env.LURQ_COMPOSITE_LAMBDA;
  if (envLambda !== undefined && envLambda !== '') {
    const n = Number(envLambda);
    if (Number.isFinite(n)) merged.composite.lambda = n;
  }

  cachedWeights = validateWeights(merged).weights;
  return cachedWeights;
}

export function resetWeightsCache(): void {
  cachedWeights = undefined;
}

function mergeWeights(base: WeightConfig, over: Partial<WeightConfig>): WeightConfig {
  return {
    health: { ...base.health, ...(over.health ?? {}) },
    composite: { ...base.composite, ...(over.composite ?? {}) },
  };
}

export interface WeightValidation {
  weights: WeightConfig;
  /** True if the health block was renormalized to sum to 1.0. */
  normalized: boolean;
}

/**
 * Clamp λ to [0,1] and renormalize the health block to sum to 1.0 (§4 invariant,
 * weights.ts:6). Returns the cleaned weights and whether normalization happened
 * so the CLI can report it.
 */
export function validateWeights(w: WeightConfig): WeightValidation {
  const lambda = Math.max(0, Math.min(1, w.composite.lambda));
  const h = w.health;
  const sum = h.maintenance + h.adoption + h.reliability + h.efficiency;
  let normalized = false;
  let health = h;
  if (sum <= 0) {
    health = { ...DEFAULT_WEIGHTS.health };
    normalized = true;
  } else if (Math.abs(sum - 1) > 1e-6) {
    health = {
      maintenance: h.maintenance / sum,
      adoption: h.adoption / sum,
      reliability: h.reliability / sum,
      efficiency: h.efficiency / sum,
    };
    normalized = true;
  }
  return { weights: { health, composite: { lambda } }, normalized };
}

/** Keys settable via `edit-weights --set` and their slot in the config. */
const SETTABLE: Record<string, (w: WeightConfig, v: number) => void> = {
  'health.maintenance': (w, v) => (w.health.maintenance = v),
  'health.adoption': (w, v) => (w.health.adoption = v),
  'health.reliability': (w, v) => (w.health.reliability = v),
  'health.efficiency': (w, v) => (w.health.efficiency = v),
  'composite.lambda': (w, v) => (w.composite.lambda = v),
};

export function settableKeys(): string[] {
  return Object.keys(SETTABLE);
}

/** Apply `key=value` overrides to a config, returning a new config. Throws on an
 *  unknown key or non-numeric value. */
export function applyOverrides(base: WeightConfig, sets: string[]): WeightConfig {
  const next = structuredClone(base);
  for (const entry of sets) {
    const eq = entry.indexOf('=');
    if (eq < 0) throw new Error(`Invalid --set "${entry}" (expected key=value).`);
    const key = entry.slice(0, eq).trim();
    const value = Number(entry.slice(eq + 1).trim());
    const apply = SETTABLE[key];
    if (!apply) {
      throw new Error(`Unknown weight key "${key}". Settable: ${settableKeys().join(', ')}.`);
    }
    if (!Number.isFinite(value)) throw new Error(`Value for "${key}" must be a number.`);
    apply(next, value);
  }
  return next;
}

/** Persist a config to the override file and bust the cache. */
export function saveWeights(w: WeightConfig, scope: 'user' | 'project' = 'user'): string {
  const path = scope === 'project' ? projectWeightsPath() : userWeightsPath();
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(w, null, 2) + '\n', 'utf8');
  resetWeightsCache();
  return path;
}

/** Remove any override files, restoring defaults. Returns the paths removed. */
export function resetWeights(): string[] {
  const removed: string[] = [];
  for (const path of [projectWeightsPath(), userWeightsPath()]) {
    if (existsSync(path)) {
      rmSync(path);
      removed.push(path);
    }
  }
  resetWeightsCache();
  return removed;
}

/** Human-readable explanation per health component / knob (§4 `--explain`). */
export const WEIGHT_EXPLANATIONS: Record<string, string> = {
  maintenance: 'release recency, cadence, and issue close-ratio (weights.ts MAINTENANCE_WEIGHTS).',
  adoption: 'weekly downloads (log-scaled), stars, and 90-day growth (weights.ts ADOPTION).',
  reliability: 'OpenSSF Scorecard scaled 0–100, minus advisory penalties (weights.ts RELIABILITY).',
  efficiency: 'bundle size vs the category median; frontend categories only (weights.ts EFFICIENCY).',
  quality:
    'intrinsic, adoption-independent: types, tests, docs, changelog, deps, license, provenance (weights.ts QUALITY_WEIGHTS). A standalone axis — it does NOT feed health.',
  lambda: 'how much the default sort composite favors quality over health: (1−λ)·health + λ·quality.',
};

/** Confidence-label thresholds (§10, §1). */
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
  /** `promising` (§1): new but intrinsically high-quality, regardless of adoption. */
  promising: {
    minQuality: 70,
    maxLastReleaseMonths: 12,
  },
} as const;
