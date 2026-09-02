/**
 * MCP tool handlers (§12.3). Pure functions over a Database — the transport
 * layer (server.ts) just wires zod schemas to these. Responses are kept compact
 * (§12.4): summaries truncated, advisories capped, no raw payloads, always a
 * `dataAsOf` and a `stale` hint when data is old (§17).
 */
import { createHash } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { cached } from '../core/cache';
import { STALENESS_DAYS } from '../core/constants';
import type {
  Advisory,
  AdvisorySeverity,
  BuildSignal,
  BuildVerified,
  Category,
  CompatOutput,
  Confidence,
  EvaluateOutput,
  UsageOutput,
  VerifyOutput,
} from '../core/types';
import { checkCompat } from '../compat/check';
import type { Database } from '../db/client';
import { getPackageByName, getTopPackageNames } from '../db/packages';
import { diffSurface } from '../usage/diff';
import { getOrExtractSurface, USAGE_EXTRACT_BUDGET_MS } from '../usage/service';
import { getLatestVerificationByName } from '../db/verification';
import { loadLearnedSuccessors, recordOutcome } from '../db/outcomes';
import { lookupSuccessor, type LearnedSuccessors } from '../core/successors';
import type { VerificationRunRow } from '../db/schema';
import { packages, type PackageRow } from '../db/schema';
import {
  fetchNpmCompatAtVersion,
  fetchNpmRegistry,
  fetchWeeklyDownloads,
  npmPackageExists,
  npmVersionExists,
} from '../ingestion/sources';
import { truncateSentences } from '../ingestion/summarize';
import { FIRST_TOUCH_BUDGET_MS, getOrFetchPackage } from '../pipeline/single';
import { hasCriticalOrHighAdvisory } from '../scoring/score';
import { recommend, type RecommendOptions } from '../search/recommend';
import { applyPolicy, hasRules, check as checkPolicy } from '../policy/enforce';
import { getSelectionPolicy, loadPolicyFacts } from '../db/selectionPolicy';
import type { PolicyVerdict } from '../policy/types';
import { assessRisk } from '../security/risk';
import { detectTyposquat, typosquatCorpus } from '../security/typosquat';

const SEVERITY_RANK: Record<AdvisorySeverity, number> = {
  critical: 4,
  high: 3,
  moderate: 2,
  low: 1,
  info: 0,
};
const DAY_MS = 24 * 60 * 60 * 1000;

function isStale(dataAsOf: Date | null): boolean {
  if (!dataAsOf) return true;
  return Date.now() - dataAsOf.getTime() > STALENESS_DAYS * DAY_MS;
}

/** Re-derive the wall-clock `stale` hint (§17) on a (possibly cached) evaluate
 *  row, so a cached response doesn't keep claiming fresh data after it ages past
 *  the threshold between syncs. */
function refreshStale(out: EvaluateOutput): EvaluateOutput {
  out.stale = isStale(out.dataAsOf ? new Date(out.dataAsOf) : null) || undefined;
  return out;
}

function withinDays(date: Date | null, days: number): boolean {
  return date ? Date.now() - date.getTime() <= days * DAY_MS : false;
}

/** Top advisories by severity, capped (§12.4). */
function topAdvisories(advisories: Advisory[] | null, max = 5): Advisory[] {
  if (!advisories?.length) return [];
  return [...advisories]
    .sort((a, b) => SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity])
    .slice(0, max);
}

/** Map a stored row to the compact EvaluateOutput shape (§12.3.2). */
export function rowToEvaluate(row: PackageRow, learned?: LearnedSuccessors): EvaluateOutput {
  const breakdown = row.scoreBreakdown ?? {
    maintenance: 0,
    adoption: 0,
    reliability: 0,
    efficiency: null,
    quality: null,
  };
  return {
    dataAsOf: (row.dataAsOf ?? new Date()).toISOString(),
    stale: isStale(row.dataAsOf) || undefined,
    name: row.name,
    category: row.category,
    healthScore: row.healthScore ?? 0,
    qualityScore: row.qualityScore ?? null,
    confidence: (row.confidence as Confidence) ?? 'unproven',
    scoreBreakdown: breakdown,
    latestVersion: row.latestVersion,
    lastReleaseAt: row.lastReleaseAt ? row.lastReleaseAt.toISOString() : null,
    weeklyDownloads: row.weeklyDownloads,
    downloadGrowth90d: row.downloadGrowth90d,
    scorecard: row.scorecard,
    bundleMinGzipKb: row.bundleMinGzipKb,
    deprecated: row.deprecated,
    archived: row.archived,
    advisories: topAdvisories(row.advisories),
    summary: row.summary ? truncateSentences(row.summary, 3) : null,
    usageGuide: row.usageGuide ?? null,
    repoUrl: row.repoUrl,
    replacedBy: lookupSuccessor(row.name, learned),
  };
}

export async function latestDataAsOf(db: Database): Promise<string> {
  const [row] = await db
    .select({ m: sql<string | null>`max(${packages.dataAsOf})` })
    .from(packages);
  return new Date(row?.m ?? Date.now()).toISOString();
}

// ── recommend ───────────────────────────────────────────────────────────────

export interface RecommendInput {
  need: string;
  category?: Category;
  constraints?: RecommendOptions['constraints'];
}

/** Short, stable cache key from arbitrary input. */
function cacheKey(parts: unknown): string {
  return createHash('sha1').update(JSON.stringify(parts)).digest('hex').slice(0, 24);
}

export async function handleRecommend(
  db: Database,
  input: RecommendInput,
  ownerId: string | null = null,
) {
  // The search itself is owner-independent, so it stays in the shared cache —
  // embeddings and hybrid retrieval are the expensive part and every owner asking
  // the same question deserves the same hit. Policy is applied *after* the cache,
  // over at most five candidates. Folding the owner into the cache key instead
  // would shard the cache per user to save a lookup that costs one indexed query.
  const base = await cached(
    'rec',
    cacheKey([input.need, input.category ?? null, input.constraints ?? null]),
    async () => {
      let degraded: string | null = null;
      const candidates = await recommend(db, {
        need: input.need,
        category: input.category,
        constraints: input.constraints,
        limit: 5,
        onDegraded: (reason) => {
          degraded = reason;
        },
      });
      return { dataAsOf: await latestDataAsOf(db), candidates, degraded };
    },
    {
      // Don't cache empty results — the index may still be populating. Nor
      // degraded ones: a lexical-only ranking written into the shared cache
      // outlives the outage that produced it and gets served back long after
      // the vector leg recovers.
      skipCache: (r) => r.candidates.length === 0 || r.degraded !== null,
    },
  );

  const policy = await getSelectionPolicy(db, ownerId);
  if (!hasRules(policy)) return base;

  const facts = await loadPolicyFacts(db, base.candidates.map((c) => c.name));
  const { allowed, excluded } = applyPolicy(policy, base.candidates, facts);

  // `excluded` is always present once a policy is in force, even when empty —
  // an agent that sees the field knows the list was filtered and that silence
  // means nothing was refused, rather than that nothing was checked.
  return { ...base, candidates: allowed, excluded };
}

// ── evaluate ────────────────────────────────────────────────────────────────

export async function handleEvaluate(
  db: Database,
  input: { package: string },
  ownerId: string | null = null,
): Promise<
  | (EvaluateOutput & { policy?: PolicyVerdict })
  | { tracked: false; suggestion: string }
> {
  const out = await cached(
    'eval',
    cacheKey([input.package]),
    async () => {
      // Block-on-first-touch (§4A): a single-package eval awaits the ingest so
      // the first call returns real evidence, not a "retry shortly" placeholder.
      const { row, existsOnNpm } = await getOrFetchPackage(db, input.package, {
        blockMs: FIRST_TOUCH_BUDGET_MS,
        requestedByOwnerId: ownerId,
      });
      if (!row) {
        return {
          tracked: false as const,
          suggestion: existsOnNpm
            ? `🎉 Congrats, you're the first to add "${input.package}" to lurq's registry! It's being fetched and scored now; retry in a few seconds for the full evidence read.`
            : `"${input.package}" was not found on the npm registry. Check the package name.`,
        };
      }
      // Only a dead package can carry a successor, so the map is worth loading
      // only for one. It is memoised, but skipping the call entirely keeps the
      // common path — evaluating a healthy package — free.
      const learned =
        row.deprecated || row.archived ? await loadLearnedSuccessors(db) : undefined;
      const evaluated = rowToEvaluate(row, learned);
      const verification = await getLatestVerificationByName(db, row.name);
      return verification
        ? { ...evaluated, buildVerified: toBuildVerified(verification) }
        : evaluated;
    },
    // Don't cache "not found / not scored yet" — it may resolve on a later fetch.
    { skipCache: (r) => 'tracked' in r },
  );
  if ('tracked' in out) return out;
  // Re-derive the time-based stale hint, which a cached row would otherwise freeze.
  const evaluated = refreshStale(out);

  // Policy verdict on a package the agent has usually already chosen. This is
  // the higher-leverage half of enforcement: `recommend` shapes a list the agent
  // asked lurq to build, but `evaluate` is the call it makes about a package it
  // found on its own — from training, a blog post, or a human's suggestion — and
  // it is the last point before the install where a rule can still apply.
  const policy = await getSelectionPolicy(db, ownerId);
  if (!hasRules(policy)) return evaluated;

  const facts = await loadPolicyFacts(db, [evaluated.name]);
  const exclusion = checkPolicy(
    policy,
    { name: evaluated.name, confidence: evaluated.confidence },
    facts.get(evaluated.name),
  );
  return { ...evaluated, policy: exclusion ? { allowed: false, ...exclusion } : { allowed: true } };
}

// ── compare ─────────────────────────────────────────────────────────────────

/**
 * One sentence per cause, so a response carrying both is unambiguous about which
 * name is which. The not-found clause leads: it is the actionable one, and an
 * agent that reads only the first sentence must read the warning, not the party.
 */
function comparisonNote(notFound: string[], pending: string[]): string {
  return [
    notFound.length
      ? `Not found on the npm registry: ${notFound.join(', ')}. Check the name(s) before installing — these do not exist.`
      : null,
    pending.length
      ? `🎉 You're the first to add ${pending.join(', ')} to lurq's registry! They're being scored now; retry shortly for the full comparison.`
      : null,
  ]
    .filter(Boolean)
    .join(' ');
}

export async function handleCompare(
  db: Database,
  input: { packages: string[] },
  ownerId: string | null = null,
) {
  // Key on the exact input — the response echoes the caller's own names/order in
  // `missing`, so a normalized key would serve another caller's casing.
  const out = await cached(
    'cmp',
    cacheKey(input.packages),
    async () => {
      const results = await Promise.all(
        input.packages.map((name) => getOrFetchPackage(db, name, { requestedByOwnerId: ownerId })),
      );
      const rows = results
        .map((r) => r.row)
        .filter((row): row is PackageRow => row !== null)
        // Not point-free: rowToEvaluate takes a second parameter now, and `.map`
        // would hand it the index.
        .map((row) => rowToEvaluate(row))
        .sort((a, b) => b.healthScore - a.healthScore);

      // A missing row has two completely different causes and they must never
      // share a message. `getOrFetchPackage` returns row=null both for a name
      // that is not on npm at all and for a real package whose ingest is still
      // running — collapsing them told an agent comparing a hallucinated name
      // that it was real and "being scored now", which is the exact failure
      // `verify` exists to prevent. Split them at the source.
      const missing: string[] = [];
      const notFound: string[] = [];
      const pending: string[] = [];
      input.packages.forEach((name, i) => {
        const result = results[i]!;
        if (result.row) return;
        missing.push(name);
        (result.existsOnNpm ? pending : notFound).push(name);
      });

      return {
        dataAsOf: await latestDataAsOf(db),
        rows,
        // `missing` stays the union, in the caller's own order, so a client
        // pinned to an older lurq keeps printing its "not found" line.
        ...(missing.length ? { missing } : {}),
        ...(notFound.length ? { notFound } : {}),
        ...(pending.length ? { pending } : {}),
        ...(missing.length ? { note: comparisonNote(notFound, pending) } : {}),
      };
    },
    // Don't cache a miss: a pending ingest lands within seconds, and a name that
    // is not on npm today may be published tomorrow.
    { skipCache: (r) => Boolean((r as { missing?: string[] }).missing?.length) },
  );
  out.rows = out.rows.map(refreshStale);
  return out;
}

// ── compat ──────────────────────────────────────────────────────────────────

function toBuildVerified(v: VerificationRunRow): BuildVerified {
  return {
    version: v.version,
    installed: v.installed,
    loaded: v.imported,
    driver: v.driver,
    ranAt: v.ranAt ? v.ranAt.toISOString() : '',
  };
}

/**
 * Whole-architecture compatibility for a set of packages: Tier-1 peer/engine
 * analysis + recorded Tier-2 sandbox conflicts (see compat/check).
 *
 * Optional `versions` pins peer/engine metadata to exact publishes (not just
 * indexed latest). Optional `node` checks each package's engines.node against
 * the target runtime.
 */
export async function handleCompat(
  db: Database,
  input: {
    packages: string[];
    versions?: Record<string, string | null | undefined>;
    node?: string | null;
  },
): Promise<CompatOutput> {
  return checkCompat(db, input.packages, {
    versions: input.versions,
    node: input.node,
  });
}

// ── verify ──────────────────────────────────────────────────────────────────

export async function handleVerify(
  db: Database,
  input: { package: string },
  ownerId: string | null = null,
): Promise<VerifyOutput> {
  const name = input.package;
  const exists = await npmPackageExists(name);
  if (!exists) {
    // A name that doesn't exist but closely mimics a popular one is a squat the
    // agent was about to fall for — surface the suspected target.
    const typo = detectTyposquat(name, typosquatCorpus(await getTopPackageNames(db).catch(() => [])));
    return {
      exists: false,
      tracked: false,
      deprecated: false,
      archived: false,
      latestVersion: null,
      weeklyDownloads: null,
      riskFlags: typo
        ? ['not-found-on-registry', `possible-typosquat-of:${typo.target}`]
        : ['not-found-on-registry'],
      risk: 'high',
      typosquatOf: typo?.target ?? null,
      confidence: null,
      advisoryCount: 0,
    };
  }

  const [registry, { row, wasTracked }, popular] = await Promise.all([
    fetchNpmRegistry(name).catch(() => null),
    // Block-on-first-touch (§4A): verify is single-package, so await the ingest
    // for a real confidence/tracked read on the first call.
    getOrFetchPackage(db, name, { blockMs: FIRST_TOUCH_BUDGET_MS, requestedByOwnerId: ownerId }),
    getTopPackageNames(db).catch(() => [] as string[]),
  ]);

  // On-demand ingestion is now async, so an untracked package has no row yet.
  // Fetch weekly downloads live (one cheap call) rather than let the risk flags
  // falsely trip 'zero-downloads' on a popular package the index hasn't caught up
  // to. Only pays the extra call on the untracked path.
  const weeklyDownloads = row?.weeklyDownloads ?? (await fetchWeeklyDownloads(name).catch(() => null));
  const advisories = row?.advisories ?? [];
  const advisoryCount = advisories.length;
  const deprecated = Boolean(row?.deprecated || registry?.deprecated);
  const archived = Boolean(row?.archived);
  const brandNew = withinDays(registry?.firstPublishedAt ?? null, 7);
  const lowTrust = weeklyDownloads === null || weeklyDownloads < 1000;
  const installScripts = registry?.hasInstallScripts ?? false;
  const typo = detectTyposquat(name, typosquatCorpus(popular));

  const riskFlags: string[] = [];
  if (typo) riskFlags.push(`possible-typosquat-of:${typo.target}`);
  if (weeklyDownloads === null || weeklyDownloads === 0) riskFlags.push('zero-downloads');
  else if (weeklyDownloads < 1000) riskFlags.push('low-downloads');
  if (brandNew) riskFlags.push('published-within-7-days');
  if (registry?.maintainersCount === 1) riskFlags.push('single-maintainer');
  if (installScripts) riskFlags.push('runs-install-scripts');
  if (advisoryCount > 0) riskFlags.push('has-known-advisory');
  if (deprecated) riskFlags.push('deprecated');
  if (archived) riskFlags.push('archived');

  const risk = assessRisk({
    flags: riskFlags,
    hasCriticalOrHighAdvisory: hasCriticalOrHighAdvisory(advisories),
    typosquat: Boolean(typo),
    installScripts,
    brandNew,
    lowTrust,
    deprecatedOrArchived: deprecated || archived,
  });

  return {
    exists: true,
    tracked: wasTracked,
    deprecated,
    archived,
    latestVersion: registry?.latestVersion ?? row?.latestVersion ?? null,
    weeklyDownloads,
    riskFlags,
    risk,
    typosquatOf: typo?.target ?? null,
    confidence: (row?.confidence as Confidence) ?? null,
    advisoryCount,
  };
}

// ── usage (§4D — API signature drift) ─────────────────────────────────────────

/**
 * Resolve the version to serve: explicit request → tracked latest → npm latest.
 *
 * An explicitly requested version is checked against the registry before it is
 * used. It used to be trusted verbatim, so `usage react --target 999.0.0` ran a
 * surface lookup that could only miss and answered "no extracted API surface for
 * this version yet; fall back to the README" — which reads as "lurq has no data"
 * when the truth is "that version does not exist". An agent acting on the first
 * message writes code against an imaginary release; the whole point of this tool
 * is that it never does that. `unpublished` is the version-level twin of
 * `verify`'s not-found-on-registry answer.
 */
type ResolvedVersion = { version: string | null; unpublished?: boolean };

async function resolveVersion(
  db: Database,
  name: string,
  requested?: string,
): Promise<ResolvedVersion> {
  if (requested) {
    // null = we could not reach npm to check. Serve the request rather than
    // accusing the caller of a bad version during our own outage; the surface
    // lookup below then degrades to its normal "no surface" note.
    const exists = await npmVersionExists(name, requested);
    return exists === false ? { version: null, unpublished: true } : { version: requested };
  }
  const row = await getPackageByName(db, name);
  if (row?.latestVersion) return { version: row.latestVersion };
  const reg = await fetchNpmRegistry(name).catch(() => null);
  return { version: reg?.latestVersion ?? null };
}

export interface UsageInput {
  package: string;
  version?: string;
  /** The version the agent already knows (e.g. its training-cutoff version) —
   *  when given, the response includes the delta the agent must account for. */
  knownVersion?: string;
}

/**
 * Version-exact API surface + optional migration delta (§4D). The surface is the
 * package's real contract, extracted from the shipped `.d.ts` — no prose lag, no
 * hallucination.
 *
 * Read-through (§4A block-on-first-touch): a stored surface is served as-is, and
 * a miss extracts from the CDN-hosted `.d.ts` within USAGE_EXTRACT_BUDGET_MS and
 * stores it, so the first request for a package populates the cache instead of
 * turning agents away. Past the budget the extraction keeps running in the
 * background and the caller gets the README-fallback note — the same answer the
 * stored-only path gave, so a slow or unreachable CDN only ever costs latency.
 *
 * The TypeScript compiler needed to parse the `.d.ts` is loaded lazily and
 * non-fatally (see usage/extract), which is what lets the public plane call this
 * without `typescript` in its dependency tree: where it isn't installed, every
 * miss simply degrades to the note.
 *
 * `knownVersion` shares ONE deadline with the primary lookup rather than getting
 * its own, so a two-version cold miss can't double the worst-case latency.
 */
export async function handleUsage(db: Database, input: UsageInput): Promise<UsageOutput> {
  const resolved = await resolveVersion(db, input.package, input.version);
  const version = resolved.version;
  if (!version) {
    return {
      package: input.package,
      version: null,
      surface: null,
      available: false,
      engines: null,
      note: resolved.unpublished
        ? `"${input.package}" has no published version ${input.version}. That release does not exist on the npm registry — check the version before writing code against it.`
        : `Could not resolve a version for "${input.package}" on npm.`,
      ...(resolved.unpublished ? { unpublishedVersion: input.version } : {}),
    };
  }

  // Both halves of the answer at once. The surface comes through the
  // read-through path (a miss extracts within the budget rather than turning the
  // caller away); `engines` is a registry read that shares none of that state,
  // so serialising them would add its latency to every request for nothing.
  const deadline = Date.now() + USAGE_EXTRACT_BUDGET_MS;
  const [surface, compat] = await Promise.all([
    getOrExtractSurface(db, input.package, version, {
      budgetMs: USAGE_EXTRACT_BUDGET_MS,
    }),
    fetchNpmCompatAtVersion(input.package, version).catch(() => null),
  ]);
  const out: UsageOutput = {
    package: input.package,
    version,
    surface,
    available: surface !== null,
    engines: compat?.engines ?? null,
    note: surface
      ? undefined
      : 'No extracted API surface for this version yet; fall back to the README.',
  };

  if (input.knownVersion && input.knownVersion !== version && surface) {
    // Whatever the primary lookup left of the budget. Never below zero: a
    // budgetMs of 0 means cache-only, which is the right call once we're out of
    // time — the delta is an enrichment, not the answer.
    const known = await getOrExtractSurface(db, input.package, input.knownVersion, {
      budgetMs: Math.max(0, deadline - Date.now()),
    });
    if (known) out.delta = { ...diffSurface(known, surface), fromVersion: input.knownVersion };
    // A caller who asked for a delta and gets a response with no `delta` field
    // has to guess whether the two versions are identical, whether we timed out,
    // or whether the version they named is fiction. Say which. The existence
    // check is paid only here, on the path where we are already about to omit
    // what was asked for, and hits the packument cache the lookup above warmed.
    else {
      const knownExists = await npmVersionExists(input.package, input.knownVersion);
      out.deltaNote =
        knownExists === false
          ? `No delta: "${input.package}" has no published version ${input.knownVersion}. That release does not exist on the npm registry.`
          : `No delta: no API surface extracted for ${input.package}@${input.knownVersion} yet. Retry shortly, or compare against a version that has been indexed.`;
    }
  }
  return out;
}

// ── report_outcome ────────────────────────────────────────────────────────────

export interface ReportOutcomeInput {
  package: string;
  accepted: boolean;
  buildSignal?: BuildSignal;
  need?: string;
}

/**
 * Capture an opt-in recommendation outcome (§3.1). Append-only, no source code —
 * just which package, accepted or not, and a coarse build signal. Not cached (a
 * write), and cheap enough that the per-key rate limiter is the only guard needed.
 * `ownerId` is server-injected from the authenticated key, attributing the
 * outcome to an org so the flywheel accrues per-customer, not to a global pool.
 */
export async function handleReportOutcome(
  db: Database,
  input: ReportOutcomeInput,
  ownerId: string | null = null,
): Promise<{ recorded: true }> {
  await recordOutcome(db, {
    ownerId,
    packageName: input.package,
    accepted: input.accepted,
    buildSignal: input.buildSignal ?? null,
    need: input.need ?? null,
  });
  return { recorded: true };
}
