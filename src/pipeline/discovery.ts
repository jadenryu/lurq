/**
 * Proactive multi-channel discovery crawler (§2B). OPERATOR-SIDE: this is a
 * scheduled job against the central index, never triggered by a user query.
 *
 * Three channels feed one queue, then a *merit* gate decides what graduates:
 *   1. Dependency-graph adjacency (deps.dev) — surfaced wholesale, NOT ranked by
 *      dependent count (that re-introduces popularity bias).
 *   2. Category-keyword + recency (npm search) — the niche workhorse; the graph
 *      structurally can't find niche alternatives.
 *   3. Merit gate — pre-scores candidates on QUALITY signals only. Downloads are
 *      deliberately excluded so merit, not popularity, decides what's ingested.
 *
 * Cost is bounded by a per-run cap; anything dropped is logged (no silent
 * truncation), and the tail stays queued for the next run.
 */
import { isNotNull } from 'drizzle-orm';
import { logger } from '../core/logger';
import { CATEGORIES } from '../core/types';
import { createDb, type Database } from '../db/client';
import {
  enqueueCandidates,
  getKnownNames,
  getPendingCandidates,
  setDiscoveryStatus,
  type DiscoveryCandidate,
} from '../db/discovery';
import { packages } from '../db/schema';
import { fetchDirectDependencies } from '../ingestion/sources/depsDev';
import { fetchNpmRegistry } from '../ingestion/sources/npmRegistry';
import { searchNpm } from '../ingestion/sources/npmSearch';
import type { RawPackageSignals } from '../ingestion/types';
import { computeQuality, toScoringInput } from '../scoring';
import { DISCOVERY } from '../scoring/weights';
import { syncOnePackage } from './single';

export interface DiscoverOptions {
  /** Max candidates to fully ingest this run (defaults to DISCOVERY.perRunCap). */
  perRunCap?: number;
  /** Discover + queue + gate, but don't ingest survivors (preview). */
  dryRun?: boolean;
}

export interface DiscoverSummary {
  enqueued: number;
  gated: number;
  passed: number;
  ingested: number;
  droppedToNextRun: number;
}

// ── Pure helpers (unit-tested) ───────────────────────────────────────────────

/** Dedupe raw candidates by name (first channel wins), dropping anything already
 *  known or with an invalid name. */
export function selectCandidates(
  raw: DiscoveryCandidate[],
  known: Set<string>,
): DiscoveryCandidate[] {
  const seen = new Set<string>(known);
  const out: DiscoveryCandidate[] = [];
  for (const c of raw) {
    const name = c.name?.trim();
    if (!name || seen.has(name)) continue;
    seen.add(name);
    out.push({ name, via: c.via });
  }
  return out;
}

/** The merit gate: quality-only pre-score must clear the bar (§2B). */
export function passesGate(preScore: number | null): boolean {
  return preScore !== null && preScore >= DISCOVERY.minPreScore;
}

/**
 * Quality-only pre-score from a single cheap registry fetch (§2B). Reuses the
 * §1 quality model but with only manifest signals — no downloads, no GitHub —
 * so the gate is adoption-independent by construction.
 */
export async function preScorePackage(
  name: string,
  fetchImpl?: typeof fetch,
): Promise<number | null> {
  try {
    const registry = await fetchNpmRegistry(name, fetchImpl);
    const signals: RawPackageSignals = {
      name,
      registry,
      downloads: null,
      github: null,
      depsDev: null,
      bundle: null,
      errors: [],
    };
    return computeQuality(toScoringInput(signals, null));
  } catch {
    return null;
  }
}

// ── Channels ─────────────────────────────────────────────────────────────────

/**
 * Dependency-graph neighbors of tracked packages (adjacency, not ranking).
 * §4G: **direct dependencies only** — the ~15 packages the author deliberately
 * chose, not the transitive closure. Enqueuing the whole closure would re-import
 * the plumbing explosion one hop later (`ms`/`bytes` etc.); BFS still reaches the
 * whole ecosystem because each discovered package contributes its own direct deps
 * on ingest — one deliberate hop at a time. The quality gate filters the rest.
 */
async function graphChannel(db: Database): Promise<DiscoveryCandidate[]> {
  const tracked = await db
    .select({ name: packages.name, version: packages.latestVersion })
    .from(packages)
    .where(isNotNull(packages.latestVersion));

  const out: DiscoveryCandidate[] = [];
  for (const t of tracked) {
    if (!t.version) continue;
    const deps = (await fetchDirectDependencies(t.name, t.version)).slice(
      0,
      DISCOVERY.graphNeighborsPerSeed,
    );
    for (const dep of deps) out.push({ name: dep.name, via: 'dependency-graph' });
  }
  return out;
}

/** Category-keyword + recency channel via npm search (the niche workhorse). */
async function searchChannel(): Promise<DiscoveryCandidate[]> {
  const out: DiscoveryCandidate[] = [];
  for (const category of CATEGORIES) {
    if (category === 'other') continue;
    const hits = await searchNpm(`keywords:${category}`, DISCOVERY.searchSizePerCategory);
    for (const hit of hits) {
      const via = isRecent(hit.date) ? 'recent' : 'category-search';
      out.push({ name: hit.name, via });
    }
  }
  return out;
}

/** Published within ~90 days counts as a "recent" entrant. */
function isRecent(date: string | null): boolean {
  if (!date) return false;
  const ms = Date.parse(date);
  if (Number.isNaN(ms)) return false;
  return Date.now() - ms <= 90 * 24 * 60 * 60 * 1000;
}

// ── Orchestration ────────────────────────────────────────────────────────────

export async function runDiscovery(opts: DiscoverOptions = {}): Promise<DiscoverSummary> {
  const cap = opts.perRunCap ?? DISCOVERY.perRunCap;
  const handle = createDb({ max: 6 });
  try {
    logger.info('Discovery: gathering candidates from graph + search channels…');
    const [graph, search] = await Promise.all([graphChannel(handle.db), searchChannel()]);
    const known = await getKnownNames(handle.db);
    const fresh = selectCandidates([...graph, ...search], known);
    const enqueued = await enqueueCandidates(handle.db, fresh);
    logger.info(
      `Discovery: ${graph.length} graph + ${search.length} search candidates → ${enqueued} new queued.`,
    );

    // ── Merit gate: pre-score pending candidates on quality only ──────────────
    const pending = await getPendingCandidates(handle.db, cap * 4);
    const scored: { name: string; preScore: number }[] = [];
    for (const cand of pending) {
      // Reuse a stored pre-score: a candidate still 'pending' with a non-null
      // pre-score already cleared the gate on a prior run and was deferred past
      // the per-run cap. Re-fetching + re-scoring it every run is a wasted
      // registry round-trip — only score candidates that have never been gated.
      if (cand.preScore !== null) {
        scored.push({ name: cand.name, preScore: cand.preScore });
        continue;
      }
      const preScore = await preScorePackage(cand.name);
      await setDiscoveryStatus(handle.db, cand.name, {
        status: passesGate(preScore) ? 'pending' : 'rejected',
        preScore: preScore ?? null,
      });
      if (passesGate(preScore)) scored.push({ name: cand.name, preScore: preScore! });
    }
    logger.info(`Discovery: gated ${pending.length}; ${scored.length} cleared the quality bar.`);

    // ── Graduate the best, capped; log (don't silently drop) the tail ─────────
    scored.sort((a, b) => b.preScore - a.preScore);
    const toIngest = scored.slice(0, cap);
    const deferred = scored.slice(cap);
    if (deferred.length > 0) {
      logger.info(
        `Discovery: per-run cap ${cap} reached — ${deferred.length} eligible candidate(s) deferred to the next run: ${deferred.map((d) => d.name).join(', ')}`,
      );
    }

    let ingested = 0;
    if (!opts.dryRun) {
      for (const cand of toIngest) {
        try {
          await syncOnePackage(handle.db, cand.name);
          await setDiscoveryStatus(handle.db, cand.name, { status: 'ingested' });
          ingested++;
        } catch (err) {
          logger.warn(`Discovery: failed to ingest ${cand.name}: ${(err as Error).message}`);
        }
      }
    }

    logger.info(`Discovery: ingested ${ingested}/${toIngest.length} candidate(s).`);
    return {
      enqueued,
      gated: pending.length,
      passed: scored.length,
      ingested,
      droppedToNextRun: deferred.length,
    };
  } finally {
    await handle.close();
  }
}
