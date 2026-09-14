/**
 * Drizzle schema (§8). One denormalized `packages` table feeds all reads (§8.2),
 * plus `sync_runs` (ingestion audit) and `seed_packages` (curated bootstrap list).
 *
 * The `vector` extension must exist before these migrations apply — `db migrate`
 * runs `CREATE EXTENSION IF NOT EXISTS vector` first (pgvector is not created
 * automatically by Drizzle).
 */
import { sql } from 'drizzle-orm';
import type { ArchetypeId, BuilderProfile } from '../github/builderProfile';
import {
  bigint,
  boolean,
  customType,
  date,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  real,
  serial,
  text,
  timestamp,
  uniqueIndex,
  vector,
} from 'drizzle-orm/pg-core';
import { EMBEDDING_DIM } from '../core/constants';
import type { ExclusionRule, SelectionPolicy } from '../policy/types';
import type { RuntimeTarget } from '../core/runtimeTarget';

/** Postgres full-text `tsvector` type for hybrid lexical search (§3). */
const tsvector = customType<{ data: string; driverData: string }>({
  dataType() {
    return 'tsvector';
  },
});
import type {
  Advisory,
  BuildSignal,
  Category,
  CategorySource,
  CompatProvenance,
  CompatStatus,
  Confidence,
  DependencyRanges,
  DiscoverySource,
  DiscoveryStatus,
  Ecosystem,
  ExportSymbol,
  PeerMeta,
  ScoreBreakdown,
  UsageGuide,
} from '../core/types';
import type { EntityKind, EvidenceClass, Verdict } from '../graph/types';
import type {
  RepoDrift,
  RepoManifest,
  RepoPolicy,
  UpgradeRunStatus,
  UpgradeSeverity,
} from '../github/types';
import type { ExtractionTier, SymbolKind } from '../surface/types';
import type { Tier } from '../core/plans';
import type { Severity } from '../audit/types';
import type { McpTool } from '../surface/mcp';
import type { PromptInfo, ResourceTemplateInfo } from '../mcpScan/snapshot';
import type { ServerAnalysis, SnapshotDiff } from '../mcpScan/analyze';
import type { Registry } from '../mcpScan/config';
import type { ScanStatus } from '../mcpScan/errors';

const ts = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' });

/**
 * One row per tracked package.
 *
 * Keyed by (ecosystem, name), never by name alone: `requests`, `redis`, `click`
 * and `attrs` are all real packages on BOTH npm and PyPI, and they are unrelated
 * software. A global unique on `name` would let whichever registry synced last
 * overwrite the other's scores, advisories and version timeline.
 */
export const packages = pgTable(
  'packages',
  {
    id: serial('id').primaryKey(),
    name: text('name').notNull(),
    ecosystem: text('ecosystem').$type<Ecosystem>().notNull().default('npm'),

    // Classification + descriptive text
    category: text('category').$type<Category>(),
    /** Whether `category` was hand-curated or inferred at ingest (§2A). */
    categorySource: text('category_source').$type<CategorySource>(),
    description: text('description'),
    summary: text('summary'),
    repoUrl: text('repo_url'),
    homepage: text('homepage'),
    latestVersion: text('latest_version'),
    license: text('license'),

    // Lifecycle flags
    deprecated: boolean('deprecated').notNull().default(false),
    archived: boolean('archived').notNull().default(false),

    // Age / maintenance signals
    firstPublishedAt: ts('first_published_at'),
    lastReleaseAt: ts('last_release_at'),

    // Adoption signals
    weeklyDownloads: bigint('weekly_downloads', { mode: 'number' }),
    downloadGrowth90d: real('download_growth_90d'),
    stars: integer('stars'),
    /**
     * Dependent counts from deps.dev, kept split rather than summed.
     *
     * `direct_dependents` counts packages that name this one in their own
     * manifest; `indirect_dependents` counts those that inherited it through
     * someone else's tree. The ratio is what distinguishes a library a human
     * chose from plumbing npm dragged in — a distinction weekly downloads and
     * GitHub stars both fail to make, because a monorepo's internal utility
     * inherits its parent's stars and every sibling's download volume.
     */
    directDependents: integer('direct_dependents'),
    indirectDependents: integer('indirect_dependents'),
    openIssues: integer('open_issues'),
    closedIssues: integer('closed_issues'),

    // Reliability / efficiency signals
    scorecard: real('scorecard'),
    bundleMinGzipKb: real('bundle_min_gzip_kb'),
    advisories: jsonb('advisories').$type<Advisory[]>(),

    // Compatibility metadata (Tier-1): declared peer-deps + engines of the
    // latest version, so a whole-stack peer-range check is one indexed query.
    peerDependencies: jsonb('peer_dependencies').$type<DependencyRanges>(),
    peerDependenciesMeta: jsonb('peer_dependencies_meta').$type<PeerMeta>(),
    engines: jsonb('engines').$type<DependencyRanges>(),
    /** Where this package runs, classified from its own manifest at ingest.
     *  Resolves the `framework` category's frontend/backend ambiguity for the
     *  architecture diagram. Null = the manifest did not say clearly enough. */
    runtimeTarget: text('runtime_target').$type<RuntimeTarget>(),

    // Computed outputs
    healthScore: integer('health_score'),
    /** Intrinsic-quality axis (§1), adoption-independent. Blends with health at
     *  ranking time (composite); never folded into health_score itself. */
    qualityScore: integer('quality_score'),
    confidence: text('confidence').$type<Confidence>(),
    scoreBreakdown: jsonb('score_breakdown').$type<ScoreBreakdown>(),
    usageGuide: jsonb('usage_guide').$type<UsageGuide>(),
    embedding: vector('embedding', { dimensions: EMBEDDING_DIM }),
    // Identity of the vector space `embedding` was produced in (e.g.
    // `openai:text-embedding-3-small`, `local`). Vector search filters on the
    // active provider so switching models can't compare incompatible spaces.
    embeddingProvider: text('embedding_provider'),

    // Lexical search vector (§3): name weighted highest (A), then category (B),
    // then summary/description (C). Generated + STORED so it stays in sync with
    // the row automatically; indexed with GIN for fast `@@` matching.
    searchVector: tsvector('search_vector').generatedAlwaysAs(
      sql`setweight(to_tsvector('english', coalesce(name, '')), 'A') || setweight(to_tsvector('english', coalesce(category, '')), 'B') || setweight(to_tsvector('english', coalesce(summary, description, '')), 'C')`,
    ),

    // Freshness + bookkeeping
    dataAsOf: timestamp('data_as_of', { withTimezone: true, mode: 'date' }),
    /** latest_version this package's direct deps were last expanded for by the
     *  discovery graph channel (§2B). Discovery re-scans a package only when this
     *  differs from latest_version — deps are version-pinned, so an unchanged
     *  version has unchanged neighbors. NULL = never scanned. */
    graphScannedVersion: text('graph_scanned_version'),
    createdAt: ts('created_at').notNull().defaultNow(),
    updatedAt: ts('updated_at').notNull().defaultNow(),
    /** The individual account (api_keys.owner_id) whose on-demand query first
     *  caused this package to be ingested — nobody had asked for it before them.
     *  Null for crawler/_changes-created packages, or ones ingested before
     *  dashboard accounts existed. Stamped once via a standalone WHERE ... IS NULL
     *  update kept out of upsertPackage, so re-syncs can never clobber it. */
    firstRequestedByOwnerId: text('first_requested_by_owner_id'),
  },
  (table) => [
    uniqueIndex('packages_ecosystem_name_idx').on(table.ecosystem, table.name),
    index('packages_category_idx').on(table.category),
    index('packages_health_score_idx').on(table.healthScore),
    // pgvector HNSW index for cosine similarity search (§11).
    index('packages_embedding_idx').using('hnsw', table.embedding.op('vector_cosine_ops')),
    // GIN index for lexical full-text search (§3).
    index('packages_search_vector_idx').using('gin', table.searchVector),
    index('packages_first_requested_by_idx').on(table.firstRequestedByOwnerId),
  ],
);

/** Ingestion audit trail (§8.1). */
export const syncRuns = pgTable('sync_runs', {
  id: serial('id').primaryKey(),
  startedAt: ts('started_at').notNull().defaultNow(),
  finishedAt: ts('finished_at'),
  packagesSeen: integer('packages_seen').notNull().default(0),
  packagesUpdated: integer('packages_updated').notNull().default(0),
  errors: jsonb('errors').$type<SyncError[]>().notNull().default([]),
  status: text('status').$type<SyncStatus>().notNull().default('running'),
  /** Which deployment started this run, `<environment>/<service>`, or null when
   *  the host injects neither (local runs). Diagnostic only: two rows in the
   *  same minute with *different* origins is a duplicate scheduler — a second
   *  environment or a second service tile running the same cron — which is
   *  otherwise invisible from the data and doubles the outbound request rate
   *  until npm starts answering 429. */
  origin: text('origin'),
});

/** Curated v1 seed list (§16), loaded from seed.json. */
export const seedPackages = pgTable('seed_packages', {
  name: text('name').primaryKey(),
  category: text('category').$type<Category>(),
  addedAt: ts('added_at').notNull().defaultNow(),
});

/**
 * Proactive-discovery candidate queue (§2B). Operator-side: the crawler enqueues
 * adjacency-graph / category-search / recent candidates here, a merit gate
 * pre-scores them on quality signals only (downloads excluded), and survivors
 * graduate to full ingestion. Keeps cost bounded and the DB free of toy packages.
 */
export const discoveryQueue = pgTable(
  'discovery_queue',
  {
    id: serial('id').primaryKey(),
    name: text('name').notNull().unique(),
    discoveredVia: text('discovered_via').$type<DiscoverySource>().notNull(),
    /** Lightweight quality-only pre-score (§2B). Null until the gate runs. */
    preScore: integer('pre_score'),
    status: text('status').$type<DiscoveryStatus>().notNull().default('pending'),
    /** Failed ingests bump this; past DISCOVERY.maxIngestAttempts the candidate
     *  is marked `failed` and stops being retried. Without it a package that
     *  throws after its summary call — a malformed manifest, a constraint
     *  violation — is re-ingested every cycle forever, paying the LLM each time
     *  and never reaching the write that would take it off the queue. Same
     *  treatment `compat_verify_queue.attempts` already gives a failing set. */
    attempts: integer('attempts').notNull().default(0),
    discoveredAt: ts('discovered_at').notNull().defaultNow(),
  },
  (table) => [index('discovery_queue_status_idx').on(table.status)],
);

/**
 * Demand-driven compat-verify queue (§4C). A `compat` query that finds an
 * unverified pair enqueues the set here (instant, off the query path); the worker
 * drains it and runs the sandbox co-install, so the matrix self-densifies from
 * real usage without ever blocking a user or running a VM in the HTTP process.
 */
export const compatVerifyQueue = pgTable(
  'compat_verify_queue',
  {
    id: serial('id').primaryKey(),
    /** Canonical order-independent key of the package set — dedups pending requests. */
    setKey: text('set_key').notNull().unique(),
    /** The package names to co-install in the sandbox. */
    packages: jsonb('packages').$type<string[]>().notNull(),
    /** Failed drains bump this; the worker drops a set that keeps failing. */
    attempts: integer('attempts').notNull().default(0),
    requestedAt: ts('requested_at').notNull().defaultNow(),
  },
  (table) => [index('compat_verify_queue_requested_idx').on(table.requestedAt)],
);

/**
 * API keys for the hosted HTTP service (docs/lurq-hosted-deployment.md §5). Each
 * user gets a key; only its sha256 hash is persisted, so a DB leak never
 * exposes a usable key — the plaintext is shown exactly once at creation.
 * `ownerId` is the individual Clerk user id, set at self-serve issuance from
 * the web dashboard (no org/team concept — one identity per account).
 */
export const apiKeys = pgTable(
  'api_keys',
  {
    id: serial('id').primaryKey(),
    /** sha256 hex of the full key — the only form persisted. */
    keyHash: text('key_hash').notNull().unique(),
    /** Identifiable display prefix, e.g. `lurq_live_ab12cd` (safe to show/log). */
    prefix: text('prefix').notNull(),
    /** Free-text label (owner / org / purpose). */
    label: text('label'),
    /** Reserved for self-serve issuance: maps to a Clerk user id. */
    ownerId: text('owner_id'),
    tier: text('tier').notNull().default('free'),
    /**
     * Permissions beyond the default read-and-call access (see KEY_SCOPES).
     * Empty by default: `lurq setup` writes a key into agent config files, and
     * a key an agent holds must never be able to loosen the rules it runs under.
     */
    scopes: text('scopes').array().notNull().default(sql`'{}'::text[]`),
    createdAt: ts('created_at').notNull().defaultNow(),
    lastUsedAt: ts('last_used_at'),
    revokedAt: ts('revoked_at'),
  },
  (table) => [index('api_keys_owner_idx').on(table.ownerId)],
);

/**
 * Per-package version timeline (versions + publish dates), ingested from the npm
 * packument on every sync. Foundation for upgrade/migration intelligence and the
 * compatibility matrix; refreshed reactively by the `_changes` follower.
 */
export const packageVersions = pgTable(
  'package_versions',
  {
    packageName: text('package_name').notNull(),
    version: text('version').notNull(),
    publishedAt: ts('published_at'),
    /** Peers/engines declared by this exact version. Lifted from the registry
     *  document at ingest (it already carries every version's manifest), so a
     *  conflict check against the versions a repo actually RUNS is one indexed
     *  query rather than a registry read per dependency. */
    peerDependencies: jsonb('peer_dependencies').$type<DependencyRanges>(),
    engines: jsonb('engines').$type<DependencyRanges>(),
  },
  (table) => [
    primaryKey({ columns: [table.packageName, table.version] }),
    index('package_versions_name_published_idx').on(table.packageName, table.publishedAt),
  ],
);

/** One row per replication feed: the cursor the npm `_changes` follower resumes
 *  from, so a restart doesn't replay the whole registry history. */
export const watchState = pgTable('watch_state', {
  id: text('id').primaryKey(),
  seq: text('seq').notNull(),
  updatedAt: ts('updated_at'),
});

/**
 * Sandbox verification results: did this package version actually install and
 * load? Evidence beyond static signals. The query path reads the latest run.
 */
export const verificationRuns = pgTable(
  'verification_runs',
  {
    id: serial('id').primaryKey(),
    packageName: text('package_name').notNull(),
    version: text('version').notNull(),
    driver: text('driver').notNull(),
    moduleSystem: text('module_system').notNull(),
    installed: boolean('installed').notNull(),
    imported: boolean('imported'),
    ranScripts: boolean('ran_scripts').notNull().default(false),
    durationMs: integer('duration_ms'),
    error: text('error'),
    ranAt: ts('ran_at'),
  },
  (table) => [index('verification_runs_pkg_idx').on(table.packageName, table.version)],
);

/**
 * Compatibility edges from co-installing two package versions in the sandbox.
 * A successful co-install is positive proof they coexist; a 2-package failure is
 * proof they conflict. Pairs are stored canonically (packageA name < packageB).
 */
export const compatEdges = pgTable(
  'compat_edges',
  {
    id: serial('id').primaryKey(),
    packageA: text('package_a').notNull(),
    versionA: text('version_a').notNull(),
    packageB: text('package_b').notNull(),
    versionB: text('version_b').notNull(),
    status: text('status').$type<CompatStatus>().notNull(),
    /** Evidence class (§4B). Existing rows are sandbox co-installs, so the column
     *  defaults to `verified` to preserve their meaning. */
    provenance: text('provenance').$type<CompatProvenance>().notNull().default('verified'),
    /** Distinct resolved graphs an `observed` edge was witnessed in (confidence).
     *  Ignored for verified/conflict. Accumulates on conflict, never overwritten. */
    witnessCount: integer('witness_count').notNull().default(0),
    driver: text('driver').notNull(),
    ranAt: ts('ran_at'),
  },
  (table) => [
    uniqueIndex('compat_edges_pair_idx').on(
      table.packageA,
      table.versionA,
      table.packageB,
      table.versionB,
    ),
  ],
);

/**
 * Persisted immutable resolved dependency closures (§4B). A `package@version`
 * always resolves to the same tree, so we store it once at first ingest; the
 * daily re-mine pass reads these with NO network to mint `observed` edges for
 * nodes that became tracked after the closure was captured.
 */
export const resolvedClosures = pgTable(
  'resolved_closures',
  {
    id: serial('id').primaryKey(),
    packageName: text('package_name').notNull(),
    version: text('version').notNull(),
    /** Full closure: [{ name, version }, …] — every node in node_modules. */
    nodes: jsonb('nodes').$type<{ name: string; version: string }[]>().notNull(),
    fetchedAt: ts('fetched_at').notNull().defaultNow(),
  },
  (table) => [uniqueIndex('resolved_closures_pkg_idx').on(table.packageName, table.version)],
);

/**
 * Extracted public API surface per `package@version` (§4D — usage axis D1).
 * Ground truth = the package's shipped `.d.ts`, parsed deterministically (no
 * LLM). Versions are immutable, so a surface is extracted once and cached
 * forever; `usage` serves it and diffs across versions for API drift.
 */
export const apiSurfaces = pgTable(
  'api_surfaces',
  {
    id: serial('id').primaryKey(),
    packageName: text('package_name').notNull(),
    version: text('version').notNull(),
    /** Normalized export list: [{ name, kind, signature }, …]. */
    surface: jsonb('surface').$type<ExportSymbol[]>().notNull(),
    extractedAt: ts('extracted_at').notNull().defaultNow(),
  },
  (table) => [uniqueIndex('api_surfaces_pkg_idx').on(table.packageName, table.version)],
);

/**
 * Recommendation → outcome capture (§3.1): the flywheel asset. lurq sits inside
 * the agent loop at the choice moment, so a lightweight opt-in callback yields a
 * recommendation→outcome dataset no downstream scanner can reconstruct (they see
 * deployed deps, not the decision). Privacy: no source code — only which package,
 * accepted or not, and a coarse build signal. Cheap to capture, compounds with use.
 */
export const recommendationOutcomes = pgTable(
  'recommendation_outcomes',
  {
    id: serial('id').primaryKey(),
    /** The individual user this outcome belongs to (api_keys.owner_id). Null for
     *  anonymous/operator-issued keys. This is what turns the flywheel from a
     *  global blob into a per-user asset — "what did *this* person succeed
     *  with." Server-injected from the authenticated key, never caller-supplied. */
    ownerId: text('owner_id'),
    packageName: text('package_name').notNull(),
    accepted: boolean('accepted').notNull(),
    buildSignal: text('build_signal').$type<BuildSignal>(),
    /** The original need text the recommendation was for — ties outcome back to
     *  the ask. Optional, length-capped at the trust boundary; never source code. */
    need: text('need'),
    createdAt: ts('created_at').notNull().defaultNow(),
  },
  (table) => [
    index('recommendation_outcomes_pkg_idx').on(table.packageName),
    index('recommendation_outcomes_owner_idx').on(table.ownerId),
  ],
);

/**
 * Durable per-account spend on dashboard Ask, one row per UTC day.
 *
 * Deliberately NOT a column on `owner_usage_daily`. That table says of itself
 * that it is display-only and its writes are fire-and-forget, so an undercount
 * on a DB hiccup is acceptable there — and a budget that undercounts on a hiccup
 * is not a budget. Writes here are awaited and their failures propagate.
 *
 * Micro-dollars as an integer, not USD as a real: this column is only ever read
 * by adding to it, and a float accumulator drifts. 1_000_000 = $1.
 */
export const askSpendDaily = pgTable(
  'ask_spend_daily',
  {
    ownerId: text('owner_id').notNull(),
    /** UTC day, 'YYYY-MM-DD'. */
    date: date('date').notNull(),
    usdMicros: bigint('usd_micros', { mode: 'number' }).notNull().default(0),
  },
  (table) => [primaryKey({ columns: [table.ownerId, table.date] })],
);

/**
 * Per-user, per-day, per-tool call counts for the dashboard usage view. Keyed by
 * ownerId (not per-key — a user can hold multiple keys; the dashboard is
 * per-individual). Display-only, not a billing ledger: writes are fire-and-forget
 * UPSERTs, so an undercount on a DB hiccup is acceptable. Skipped entirely when a
 * request has no ownerId (operator-issued keys with no dashboard account).
 */
export const ownerUsageDaily = pgTable(
  'owner_usage_daily',
  {
    ownerId: text('owner_id').notNull(),
    /** UTC day, 'YYYY-MM-DD'. */
    date: date('date').notNull(),
    /** recommend | evaluate | compare | compat | verify | usage | diagram | plan | report_outcome */
    tool: text('tool').notNull(),
    count: integer('count').notNull().default(0),
  },
  (table) => [
    primaryKey({ columns: [table.ownerId, table.date, table.tool] }),
    index('owner_usage_daily_owner_date_idx').on(table.ownerId, table.date),
  ],
);

/**
 * A GitHub repository connected through the lurq App (repo autopilot).
 *
 * What is NOT here is the point: no source, no tokens, no clone. `manifests`
 * holds only declared dependency ranges, and access is re-minted per scan from
 * the App's own installation credentials, so revoking the install revokes
 * everything instantly and there is no long-lived secret to leak.
 */
export const repos = pgTable(
  'repos',
  {
    id: serial('id').primaryKey(),
    /** Clerk user id — same identity as api_keys.owner_id. */
    ownerId: text('owner_id').notNull(),
    /** GitHub App installation this repo is reachable through. */
    installationId: bigint('installation_id', { mode: 'number' }).notNull(),
    /** `owner/name`. */
    fullName: text('full_name').notNull(),
    defaultBranch: text('default_branch'),
    isPrivate: boolean('is_private').notNull().default(false),
    policy: jsonb('policy').$type<RepoPolicy>().notNull(),
    manifests: jsonb('manifests').$type<RepoManifest[]>(),
    /** Install command detected from the lockfile at scan time, so the generated
     *  workflow uses the repo's actual package manager instead of assuming npm. */
    installCommand: text('install_command'),
    drift: jsonb('drift').$type<RepoDrift>(),
    lastScanAt: ts('last_scan_at'),
    /** Last scan failure, surfaced in the dashboard. Null once a scan succeeds —
     *  a stale error next to fresh drift numbers reads as a current outage. */
    lastScanError: text('last_scan_error'),
    createdAt: ts('created_at').notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('repos_owner_full_name_idx').on(table.ownerId, table.fullName),
    index('repos_installation_idx').on(table.installationId),
  ],
);

/**
 * One row per upgrade the CI loop considered — the observability spine of the
 * autopilot, and what the dashboard's impact figures are computed from.
 *
 * Written by the user's own workflow through an API key, so everything here is
 * caller-supplied and validated at the boundary. Deliberately narrow: symbol
 * names and counts, never file contents. `callSites` is a count and always
 * safe to send; `callSiteFiles` carries paths and is only populated when the
 * repo's policy opts in, because a file path is information about someone's
 * codebase even though it is not source.
 */
export const upgradeRuns = pgTable(
  'upgrade_runs',
  {
    id: serial('id').primaryKey(),
    /** Resolved server-side from the authenticated API key. Never caller-supplied. */
    ownerId: text('owner_id').notNull(),
    /** Links to `repos` when the repo is also connected. Null when the workflow
     *  runs somewhere lurq has no GitHub App installation — the CLI works
     *  standalone, and losing those runs would bias every impact figure. */
    repoId: integer('repo_id'),
    /** `owner/name` from GITHUB_REPOSITORY. */
    repoFullName: text('repo_full_name').notNull(),
    packageName: text('package_name').notNull(),
    fromVersion: text('from_version').notNull(),
    toVersion: text('to_version').notNull(),
    severity: text('severity').$type<UpgradeSeverity>().notNull(),
    status: text('status').$type<UpgradeRunStatus>().notNull(),
    /** Referenced symbols the upgrade removes or re-shapes. */
    symbolsAffected: jsonb('symbols_affected').$type<string[]>().notNull().default([]),
    /** How many references those symbols have in the repo. */
    callSites: integer('call_sites').notNull().default(0),
    /** Distinct files containing them. Opt-in per repo policy. */
    callSiteFiles: jsonb('call_site_files').$type<string[]>(),
    filesChanged: integer('files_changed'),
    /** Null when the repo has no test script — distinct from `false`, which
     *  means the suite ran and failed. */
    testsPassed: boolean('tests_passed'),
    prUrl: text('pr_url'),
    /**
     * The GitHub Actions run, so a dashboard row links back to real logs.
     * NOT NULL with an empty-string default rather than nullable: it is part of
     * the dedup key below, and Postgres treats NULLs as distinct — a nullable
     * column there would silently let every re-post insert a duplicate. Empty
     * means "posted outside Actions" (a local CLI run), which then dedups to one
     * row per package+target and updates in place.
     */
    runUrl: text('run_url').notNull().default(''),
    createdAt: ts('created_at').notNull().defaultNow(),
  },
  (table) => [
    index('upgrade_runs_owner_created_idx').on(table.ownerId, table.createdAt),
    index('upgrade_runs_repo_idx').on(table.repoId),
    // One row per package per Actions run: a re-post of the same run must update
    // rather than duplicate, or a retried job would double every impact figure.
    uniqueIndex('upgrade_runs_dedup_idx').on(
      table.ownerId,
      table.repoFullName,
      table.packageName,
      table.toVersion,
      table.runUrl,
    ),
  ],
);

/**
 * A breaking release that landed on a package a connected repo depends on.
 *
 * This is the reactive half of the autopilot. The nightly scan answers "how far
 * behind is this repo"; a row here answers "something broke *just now*", written
 * within seconds of the publish by the `_changes` follower rather than up to a
 * day later. The whole point is latency: a major that ships on Tuesday is no use
 * to anyone if the repo hears about it on Monday.
 *
 * Deliberately derived from the manifests already stored on `repos` — emitting an
 * alert costs one indexed query and zero GitHub calls, so a heavily-depended
 * package publishing cannot fan out into thousands of API requests.
 */
export const repoAlerts = pgTable(
  'repo_alerts',
  {
    id: serial('id').primaryKey(),
    /** Clerk user id, copied from the repo — alerts are read owner-scoped. */
    ownerId: text('owner_id').notNull(),
    repoId: integer('repo_id').notNull(),
    /** Denormalized so the feed renders without a join, as in `upgrade_runs`. */
    repoFullName: text('repo_full_name').notNull(),
    packageName: text('package_name').notNull(),
    /** The range this repo declared when the release landed. */
    range: text('range').notNull(),
    /** What that range resolved to at the last scan. Null when the index had no
     *  version timeline for the package yet — never guessed. */
    fromVersion: text('from_version'),
    /** The release that triggered this. */
    toVersion: text('to_version').notNull(),
    /**
     * True when the declared range already admits `toVersion` — i.e. the next
     * clean install silently takes the new major. That is the urgent case and the
     * one no drift number expresses: the repo is not "behind", it is about to
     * move on its own.
     */
    inRange: boolean('in_range').notNull(),
    createdAt: ts('created_at').notNull().defaultNow(),
  },
  (table) => [
    index('repo_alerts_owner_created_idx').on(table.ownerId, table.createdAt),
    // The notification sender scans recent alerts across every owner.
    index('repo_alerts_created_idx').on(table.createdAt),
    // One alert per repo per release. A re-sync of the same version — and the
    // watcher re-syncs on every publish, including non-latest backports — must
    // not re-notify.
    uniqueIndex('repo_alerts_dedup_idx').on(table.repoId, table.packageName, table.toVersion),
  ],
);

export type SyncStatus = 'running' | 'success' | 'partial' | 'failed';

export interface SyncError {
  package: string;
  source: string;
  message: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// v2 graph (docs/lurq-v2-spec.md §5). Generic entity/claim/observation model,
// running ALONGSIDE the npm-specific tables above — not replacing them yet.
//
// This duplication is a deliberate, dated decision, not drift. The spec's M1
// says migrate npm onto this model; its own kill condition is "existing
// functionality regresses", and the npm path is the only thing with users.
// Rewriting it to prove a schema no second consumer has exercised is the
// highest-risk, lowest-information move available.
//
//   TRIGGER TO MIGRATE: a second node type (per the plan, `mcp_server`) is
//   storing verdicts here in production. That is what turns "the shape looks
//   right" into "the shape held for something that is not npm". Until then the
//   cost of carrying both is a few hundred rows of overlap and this comment.
//
// See docs/lurq-v2-integration-plan.md §4.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Demand-driven surface-extraction queue (§6.1).
 *
 * A query for a package-version not in the graph IS a discovery event, and the
 * spec ranks it the highest-priority queue input because it is revealed demand
 * rather than a guess about what matters. Enqueueing is instant and off the
 * query path: extraction never runs synchronously inside a request (§8), so a
 * miss returns UNKNOWN and the worker fills it in.
 *
 * Same shape as compat_verify_queue, deliberately — that loop already works.
 */
export const surfaceQueue = pgTable(
  'surface_queue',
  {
    id: serial('id').primaryKey(),
    packageName: text('package_name').notNull(),
    /** Null means "whatever latest resolves to at extraction time". */
    version: text('version'),
    /**
     * Which extractor services this row.
     *
     * One queue, two drains: `package_surface` rows are fetched as tarballs and
     * read statically, `mcp_server` rows are installed and probed over stdio.
     * The discriminator is not optional bookkeeping — without it the npm drain
     * picks up MCP rows and tries to extract exports from a server it should
     * have handshaked with, and the failure is silent because "no exports
     * found" is a legitimate answer for a package that has none.
     */
    kind: text('kind').$type<EntityKind>().notNull().default('package_surface'),
    /** Dedup key: `kind:name@version`. */
    specKey: text('spec_key').notNull().unique(),
    /** Failed drains bump this; the worker drops a spec that keeps failing. */
    attempts: integer('attempts').notNull().default(0),
    requestedAt: ts('requested_at').notNull().defaultNow(),
  },
  (table) => [index('surface_queue_requested_idx').on(table.kind, table.requestedAt)],
);

/** A node in the graph. Anything an agent depends on that an oracle can check. */
export const entities = pgTable(
  'entities',
  {
    id: serial('id').primaryKey(),
    kind: text('kind').$type<EntityKind>().notNull(),
    /** Registry or authority: npm, api.stripe.com, … */
    namespace: text('namespace').notNull(),
    name: text('name').notNull(),
    /** Null for unversioned kinds. */
    version: text('version'),
    /** `kind:namespace:name:version` */
    canonicalKey: text('canonical_key').notNull(),
    /**
     * 0 = the public graph; a real id = a private deployment's tenant. The spec
     * models public as NULL, but Postgres UNIQUE treats NULLs as distinct, so
     * (key, NULL) would insert unlimited duplicates and the dedup silently fails.
     * A non-null sentinel is the cheap fix that works on every PG version.
     */
    tenantId: bigint('tenant_id', { mode: 'number' }).notNull().default(0),
    /** Tarball digest. THE extraction cache key: unchanged digest, no re-extraction.
     *  This is what keeps cost sublinear as the index grows (§5, §6.5). */
    artifactHash: text('artifact_hash'),
    /** Dependent count. Drives sampling AND refresh priority — and note priority
     *  is NOT popularity: the study found drift concentrates at LOW in-degree
     *  (18.7% vs 8.3%), which is exactly where models have the weakest priors. */
    inDegree: integer('in_degree'),
    firstSeen: ts('first_seen').notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('entities_canonical_idx').on(table.canonicalKey, table.tenantId),
    index('entities_kind_idx').on(table.kind, table.namespace, table.name),
    index('entities_artifact_idx').on(table.artifactHash),
  ],
);

/**
 * One row per exported symbol of a package version (§5).
 *
 * `origin` and `tier` are not decoration — each exists because of a defect that
 * silently corrupted the drift study:
 *   - `origin` (§6.4.1): a symbol re-exported from another package is not this
 *     package's surface. Counting them made one package appear to delete 168
 *     exports when the true figure was 0.
 *   - `tier` (§6.4.3): surfaces extracted at different tiers are NOT comparable,
 *     so the tier has to travel with every symbol or diffs go wrong quietly.
 */
/**
 * `max_arity` for a function that reads any number of arguments.
 * ponytail: a sentinel rather than a second column. One nullable integer already
 * carries the IR's three states (not measured, unbounded, a count).
 */
export const UNBOUNDED_ARITY = -1;

export const symbols = pgTable(
  'symbols',
  {
    id: serial('id').primaryKey(),
    entityId: integer('entity_id')
      .notNull()
      .references(() => entities.id),
    /** 'default', 'foo', 'foo.bar' */
    path: text('path').notNull(),
    /** function | class | object | primitive | type_only */
    kind: text('kind').$type<SymbolKind>().notNull(),
    /** `fn.length` equivalent; null when not statically determinable. */
    arity: integer('arity'),
    /** 'local' | 'external:<pkg>' */
    origin: text('origin').notNull().default('local'),
    deprecated: boolean('deprecated').notNull().default(false),
    tier: text('tier').$type<ExtractionTier>().notNull(),
    /** Full declaration text; tier C only (§6.2). */
    signature: text('signature'),
    sourceFile: text('source_file'),
    sourceLine: integer('source_line'),
    /** Character offset of the declaration. Two exports sharing file and offset
     *  are one value under two names, which is how a diff read from storage finds
     *  a proven rename. Null on rows extracted before it was recorded. */
    sourceOffset: integer('source_offset'),
    /** Most arguments the function reads: null when not measured, UNBOUNDED_ARITY
     *  for a rest parameter or `arguments`. See SurfaceSymbol.maxArity. */
    maxArity: integer('max_arity'),
  },
  // Keyed by TIER as well as path: a package version has one surface per tier and
  // they are not interchangeable (§6.4.3). Without the tier in the key, storing a
  // tier-C surface would silently overwrite the tier-A one that answers runtime
  // existence — replacing the authoritative answer with a type-level guess.
  (table) => [
    uniqueIndex('symbols_entity_path_tier_idx').on(table.entityId, table.path, table.tier),
  ],
);

/** The runtime a verdict holds in. Never a node — always a dimension (§2). */
export const environments = pgTable('environments', {
  id: serial('id').primaryKey(),
  os: text('os').notNull(),
  arch: text('arch').notNull(),
  runtime: text('runtime').notNull(),
  runtimeVer: text('runtime_ver').notNull(),
  resolver: text('resolver'),
  /** Hash of the above; the dedup key. */
  fingerprint: text('fingerprint').notNull().unique(),
});

/** A (subject, relation, object, environment) tuple awaiting observations. */
export const claims = pgTable(
  'claims',
  {
    id: serial('id').primaryKey(),
    subjectId: integer('subject_id')
      .notNull()
      .references(() => entities.id),
    /** Null for unary claims ("does this install at all"). */
    objectId: integer('object_id').references(() => entities.id),
    relation: text('relation').notNull(),
    /** NULL for DECLARED claims: a shipped-JS surface reads the same on every
     *  machine, so there is no environment to fingerprint. Executed claims
     *  (co-install, conflict, behaviour) always carry one (§5). */
    environmentId: integer('environment_id').references(() => environments.id),
    tenantId: bigint('tenant_id', { mode: 'number' }).notNull().default(0),
  },
  (table) => [
    uniqueIndex('claims_tuple_idx').on(
      table.subjectId,
      table.objectId,
      table.relation,
      table.environmentId,
      table.tenantId,
    ),
  ],
);

/**
 * APPEND-ONLY. Verdicts are never mutated — the history is the product, and
 * `breaks_at` (the highest-value edge in the graph) is derived by scanning
 * observations across versions. `stale` is applied at READ time from the
 * oracle's TTL, never written by a background job.
 */
export const observations = pgTable(
  'observations',
  {
    id: serial('id').primaryKey(),
    claimId: integer('claim_id')
      .notNull()
      .references(() => claims.id),
    verdict: text('verdict').$type<Verdict>().notNull(),
    /** What KIND of evidence backs the verdict (§4.1) — orthogonal to the verdict
     *  itself. A declared surface fact must never read as behavioural proof. */
    class: text('class').$type<EvidenceClass>().notNull().default('executed'),
    /** Which extraction tier produced it; null for executed claims. */
    tier: text('tier').$type<ExtractionTier>(),
    /** Evidence that makes the verdict auditable. Null only for `unknown`. */
    evidence: text('evidence'),
    oracleId: text('oracle_id').notNull(),
    oracleVer: text('oracle_ver').notNull(),
    costMillis: integer('cost_millis'),
    observedAt: ts('observed_at').notNull().defaultNow(),
  },
  (table) => [index('observations_claim_idx').on(table.claimId, table.observedAt)],
);

export type PackageRow = typeof packages.$inferSelect;
export type NewPackageRow = typeof packages.$inferInsert;
export type EntityRow = typeof entities.$inferSelect;
export type NewEntityRow = typeof entities.$inferInsert;
export type EnvironmentRow = typeof environments.$inferSelect;
export type ClaimRow = typeof claims.$inferSelect;
export type ObservationRow = typeof observations.$inferSelect;
export type SymbolRow = typeof symbols.$inferSelect;
export type SurfaceQueueRow = typeof surfaceQueue.$inferSelect;
export type NewSymbolRow = typeof symbols.$inferInsert;
export type NewObservationRow = typeof observations.$inferInsert;
export type SeedPackageRow = typeof seedPackages.$inferSelect;
/**
 * Per-owner selection policy — the rules governing what an agent may *add*.
 *
 * One row per owner, keyed by the Clerk id already used by `api_keys.owner_id`
 * and `repos.owner_id`. Clerk namespaces ids by prefix, so when organisations
 * are switched on this column holds an `org_…` id with no migration and no
 * membership tables. See policy/types for why that is the right amount of
 * structure to build today.
 */
export const selectionPolicies = pgTable('selection_policies', {
  ownerId: text('owner_id').primaryKey(),
  policy: jsonb('policy').$type<SelectionPolicy>().notNull(),
  updatedAt: ts('updated_at').notNull().defaultNow(),
});

/**
 * Every replacement of a selection policy: who did it, from where, both sides.
 *
 * Append-only. A policy decides what a whole team's agents may install, and
 * "who allowed this, and when" is the first question after anything slips
 * through. Both sides are stored whole rather than as a diff, so the record
 * survives the rule sentences changing wording.
 */
export const selectionPolicyChanges = pgTable(
  'selection_policy_changes',
  {
    id: serial('id').primaryKey(),
    ownerId: text('owner_id').notNull(),
    /** `dashboard`, or the display prefix of the API key that pushed it. */
    actor: text('actor').notNull(),
    before: jsonb('before').$type<SelectionPolicy>().notNull(),
    after: jsonb('after').$type<SelectionPolicy>().notNull(),
    createdAt: ts('created_at').notNull().defaultNow(),
  },
  (table) => [index('selection_policy_changes_owner_idx').on(table.ownerId, table.createdAt)],
);

/**
 * Each time a rule refused a package an agent reached for, or would have in
 * warn mode.
 *
 * Only refusals are written, never passes: the volume is bounded by how often
 * a policy bites, and a log of everything allowed is a usage log we already
 * keep. This is what makes warn mode worth switching on (what would this rule
 * have caught?) and what shows an account the policy is doing work.
 * ponytail: no retention job; add a created_at prune when a busy account's row
 * count matters.
 */
export const policyDecisions = pgTable(
  'policy_decisions',
  {
    id: serial('id').primaryKey(),
    ownerId: text('owner_id').notNull(),
    packageName: text('package_name').notNull(),
    rule: text('rule').$type<ExclusionRule>().notNull(),
    /** `blocked` under enforce, `warned` under warn. */
    action: text('action').$type<'blocked' | 'warned'>().notNull(),
    /** The tool the agent called: recommend | evaluate. */
    tool: text('tool').notNull(),
    createdAt: ts('created_at').notNull().defaultNow(),
  },
  (table) => [index('policy_decisions_owner_idx').on(table.ownerId, table.createdAt)],
);

export type SyncRunRow = typeof syncRuns.$inferSelect;
export type DiscoveryQueueRow = typeof discoveryQueue.$inferSelect;
export type CompatVerifyQueueRow = typeof compatVerifyQueue.$inferSelect;
export type ApiKeyRow = typeof apiKeys.$inferSelect;
export type NewApiKeyRow = typeof apiKeys.$inferInsert;
export type PackageVersionRow = typeof packageVersions.$inferSelect;
export type NewPackageVersionRow = typeof packageVersions.$inferInsert;
export type VerificationRunRow = typeof verificationRuns.$inferSelect;
export type NewVerificationRunRow = typeof verificationRuns.$inferInsert;
export type CompatEdgeRow = typeof compatEdges.$inferSelect;
export type NewCompatEdgeRow = typeof compatEdges.$inferInsert;
export type ResolvedClosureRow = typeof resolvedClosures.$inferSelect;
export type NewResolvedClosureRow = typeof resolvedClosures.$inferInsert;
export type ApiSurfaceRow = typeof apiSurfaces.$inferSelect;
export type NewApiSurfaceRow = typeof apiSurfaces.$inferInsert;
export type RecommendationOutcomeRow = typeof recommendationOutcomes.$inferSelect;
export type NewRecommendationOutcomeRow = typeof recommendationOutcomes.$inferInsert;
export type OwnerUsageDailyRow = typeof ownerUsageDaily.$inferSelect;
export type NewOwnerUsageDailyRow = typeof ownerUsageDaily.$inferInsert;
export type RepoRow = typeof repos.$inferSelect;
export type NewRepoRow = typeof repos.$inferInsert;
export type UpgradeRunRow = typeof upgradeRuns.$inferSelect;
export type NewUpgradeRunRow = typeof upgradeRuns.$inferInsert;
export type RepoAlertRow = typeof repoAlerts.$inferSelect;
export type NewRepoAlertRow = typeof repoAlerts.$inferInsert;
/**
 * Billing state for one account, mirrored from Stripe.
 *
 * Stripe is the authority; this is a local read-replica of the two facts the
 * request path needs — which tier, and is it still being served — so a tool
 * call resolves entitlement from Postgres instead of a network hop to Stripe on
 * every request. Written only by the webhook.
 *
 * Keyed by `ownerId` (the Clerk user id), NOT by API key. Entitlement belongs to
 * the account: a user with four keys bought one subscription, and putting the
 * tier on `api_keys` would let them mint themselves a free upgrade by issuing a
 * new key. `api_keys.tier` predates this and is display-only.
 *
 * `tier` is derived from the Stripe Price at webhook time rather than stored on
 * the customer, so re-pricing a plan does not require a backfill.
 */
export const subscriptions = pgTable(
  'subscriptions',
  {
    /** Clerk user id. One subscription per account. */
    ownerId: text('owner_id').primaryKey(),
    /** Stable across subscriptions: a customer who cancels and returns reuses it. */
    stripeCustomerId: text('stripe_customer_id').notNull().unique(),
    /** Null between creating a customer and completing a first checkout. */
    stripeSubscriptionId: text('stripe_subscription_id').unique(),
    tier: text('tier').$type<Tier>().notNull().default('free'),
    /** Raw Stripe subscription status. `null` = never subscribed. */
    status: text('status'),
    /** When the paid period lapses. Display only; `status` is what gates access. */
    currentPeriodEnd: ts('current_period_end'),
    /** Set when the user cancels but has paid through the period. */
    cancelAtPeriodEnd: boolean('cancel_at_period_end').notNull().default(false),
    /**
     * Seats bought, from the Stripe subscription quantity. Only per-seat plans
     * read it, and `billedSeats` floors it at the plan's minimum, so a flat plan
     * or a pre-seat row carrying the default 1 resolves correctly either way.
     */
    seats: integer('seats').notNull().default(1),
    /** The subscription carries the metered overage item, so calls past the pool bill. */
    overageEnabled: boolean('overage_enabled').notNull().default(false),
    /** Calendar month ('YYYY-MM') that `overageReported` counts. */
    overageMonth: text('overage_month'),
    /** Overage calls already sent to Stripe for `overageMonth`. */
    overageReported: integer('overage_reported').notNull().default(0),
    /** The plan item's Stripe interval ('month' | 'year'). Null for manual grants. */
    billingInterval: text('billing_interval'),
    /**
     * Stripe delivers out of order and retries, so a late duplicate of an older
     * event must not overwrite newer state. The webhook drops any event whose
     * timestamp is older than the one that produced the current row.
     */
    lastEventAt: ts('last_event_at'),
    createdAt: ts('created_at').notNull().defaultNow(),
    updatedAt: ts('updated_at').notNull().defaultNow(),
  },
  (table) => [index('subscriptions_customer_idx').on(table.stripeCustomerId)],
);

export type SubscriptionRow = typeof subscriptions.$inferSelect;
export type NewSubscriptionRow = typeof subscriptions.$inferInsert;

export type SelectionPolicyRow = typeof selectionPolicies.$inferSelect;
export type NewSelectionPolicyRow = typeof selectionPolicies.$inferInsert;

/**
 * A resolved stack — one row per distinct package set, keyed by exact versions.
 *
 * This replaces pairwise `compat_edges` as the compatibility mechanism, for two
 * reasons that are both about correctness before cost:
 *
 *   1. **npm resolves sets, not pairs.** Three packages can be compatible in
 *      every pair and still fail together — a diamond dependency or a peer range
 *      that only becomes unsatisfiable with all three present. A pairwise model
 *      cannot express the conflicts npm actually reports, so it was answering a
 *      different question than the one asked.
 *   2. **Pairs are quadratic, sets are not.** One row per asked stack instead of
 *      C(n,2) per stack. Storage tracks *demand* — how many distinct stacks
 *      humans assemble — instead of tracking the square of the catalog.
 *
 * `names` duplicates the names already in `packages` because invalidation asks
 * "which stacks contain X?" on every npm publish, and that has to be one indexed
 * lookup rather than a scan over jsonb.
 *
 * Only definitive results are ever written. A resolve that times out or fails on
 * the network is inconclusive and must not be cached — a stored non-answer would
 * poison that stack until something evicted it.
 */
export const stackResolutions = pgTable(
  'stack_resolutions',
  {
    id: serial('id').primaryKey(),
    /** Canonical `name@version|name@version|…`, sorted. The cache key. */
    setKey: text('set_key').notNull().unique(),
    /** The exact members this verdict is about. */
    packages: jsonb('packages').$type<{ name: string; version: string }[]>().notNull(),
    /** Names only, for publish-driven invalidation. */
    names: text('names').array().notNull(),
    /** True when npm produced a lockfile for the set. */
    resolved: boolean('resolved').notNull(),
    /** 'ERESOLVE' for a proven conflict; null when it resolved. */
    reason: text('reason'),
    /** npm's own error text on a conflict — it names the packages and ranges. */
    detail: text('detail'),
    resolvedAt: ts('resolved_at').notNull().defaultNow(),
  },
  (table) => [
    index('stack_resolutions_names_idx').using('gin', table.names),
    index('stack_resolutions_resolved_at_idx').on(table.resolvedAt),
  ],
);

export type StackResolutionRow = typeof stackResolutions.$inferSelect;
export type NewStackResolutionRow = typeof stackResolutions.$inferInsert;

// ─────────────────────────────────────────────────────────────────────────────
// Live MCP scans. Contracts read by the user's own client, with their own
// configuration, uploaded under their account.
//
// Shaped for a daily scan across many accounts without the tables growing at
// the rate of scans:
//   - a contract is stored ONCE per content hash, whoever uploaded it
//   - an observation is a CHANGE POINT: an unchanged daily scan updates
//     `last_seen_at` and `scan_count` on the current row instead of inserting
//   - change events are unique per (deployment, from, to), so a server that
//     flaps between two contracts re-arms one event rather than filling a feed
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Everything the model reads from one server version, content-addressed.
 *
 * Immutable and owner-independent: two accounts running the same public server
 * share one row, and a private server's row is only ever reached through that
 * owner's deployment. There is deliberately no read by hash from outside.
 * ponytail: no GC for contracts no deployment points at any more; add a sweep
 * when the table's size is worth a job.
 */
export const mcpContracts = pgTable(
  'mcp_contracts',
  {
    contentHash: text('content_hash').primaryKey(),
    /** Schema-only hash; equal means calls validate identically. */
    contractHash: text('contract_hash').notNull(),
    tools: jsonb('tools').$type<McpTool[]>().notNull(),
    prompts: jsonb('prompts').$type<PromptInfo[]>().notNull(),
    resourceTemplates: jsonb('resource_templates').$type<ResourceTemplateInfo[]>().notNull(),
    instructions: text('instructions'),
    toolCount: integer('tool_count').notNull(),
    bytes: integer('bytes').notNull(),
    /** Computed server-side at insert, never taken from the client. */
    analysis: jsonb('analysis').$type<ServerAnalysis>().notNull(),
    analyzerVersion: text('analyzer_version').notNull(),
    createdAt: ts('created_at').notNull().defaultNow(),
  },
  (table) => [index('mcp_contracts_contract_idx').on(table.contractHash)],
);

/**
 * One server as one account runs it: identity plus configuration fingerprint.
 *
 * The same package under two configurations is two deployments, because it
 * exposes two contracts. Denormalizes the latest state so the dashboard list is
 * one indexed read.
 */
export const mcpDeployments = pgTable(
  'mcp_deployments',
  {
    id: serial('id').primaryKey(),
    ownerId: text('owner_id').notNull(),
    serverKey: text('server_key').notNull(),
    configFingerprint: text('config_fingerprint').notNull(),
    /** The name the user gave it, as last seen. Display only. */
    alias: text('alias').notNull(),
    registry: text('registry').$type<Registry>().notNull(),
    packageName: text('package_name'),
    transport: text('transport').notNull(),
    /** Self-reported by the server in its handshake. */
    serverName: text('server_name'),
    serverVersion: text('server_version'),
    lastStatus: text('last_status').$type<ScanStatus>().notNull(),
    lastError: text('last_error'),
    /** The last contract actually read. Kept when a later scan fails. */
    lastContentHash: text('last_content_hash'),
    worstSeverity: text('worst_severity').$type<Severity>(),
    firstSeenAt: ts('first_seen_at').notNull().defaultNow(),
    lastScannedAt: ts('last_scanned_at').notNull().defaultNow(),
    lastChangedAt: ts('last_changed_at'),
  },
  (table) => [
    uniqueIndex('mcp_deployments_identity_idx').on(table.ownerId, table.serverKey, table.configFingerprint),
    index('mcp_deployments_owner_idx').on(table.ownerId, table.lastScannedAt),
  ],
);

/**
 * What a deployment looked like over an interval: run-length encoded scans.
 *
 * A new row only when status, contract or self-reported version moves; every
 * identical scan in between bumps `scan_count` and `last_seen_at`. The history
 * is therefore exact to the scan cadence and bounded by how often servers
 * actually change.
 */
export const mcpObservations = pgTable(
  'mcp_observations',
  {
    id: serial('id').primaryKey(),
    deploymentId: integer('deployment_id')
      .notNull()
      .references(() => mcpDeployments.id),
    ownerId: text('owner_id').notNull(),
    status: text('status').$type<ScanStatus>().notNull(),
    contentHash: text('content_hash'),
    serverVersion: text('server_version'),
    error: text('error'),
    /** `cli` or `ci`: who ran the scan that opened this interval. */
    source: text('source').notNull(),
    scanCount: integer('scan_count').notNull().default(1),
    firstSeenAt: ts('first_seen_at').notNull().defaultNow(),
    lastSeenAt: ts('last_seen_at').notNull().defaultNow(),
  },
  (table) => [index('mcp_observations_deployment_idx').on(table.deploymentId, table.firstSeenAt)],
);

/** A contract change worth telling the owner about, with the full diff. */
export const mcpChangeEvents = pgTable(
  'mcp_change_events',
  {
    id: serial('id').primaryKey(),
    deploymentId: integer('deployment_id')
      .notNull()
      .references(() => mcpDeployments.id),
    ownerId: text('owner_id').notNull(),
    fromHash: text('from_hash').notNull(),
    toHash: text('to_hash').notNull(),
    severity: text('severity').$type<Severity>().notNull(),
    summary: text('summary').notNull(),
    diff: jsonb('diff').$type<SnapshotDiff>().notNull(),
    createdAt: ts('created_at').notNull().defaultNow(),
    acknowledgedAt: ts('acknowledged_at'),
  },
  (table) => [
    uniqueIndex('mcp_change_events_pair_idx').on(table.deploymentId, table.fromHash, table.toHash),
    index('mcp_change_events_owner_idx').on(table.ownerId, table.createdAt),
    index('mcp_change_events_created_idx').on(table.createdAt),
  ],
);

/**
 * An account's scan of a PUBLISHED server, offered as corroboration.
 *
 * A client can never write straight into the shared index: a poisoned tool list
 * would be served to everyone. A version's contract is promoted only when
 * enough distinct accounts independently read the same content hash, and the
 * sandbox probe stays the authority that overrides it.
 */
export const mcpPublicReports = pgTable(
  'mcp_public_reports',
  {
    registry: text('registry').notNull(),
    packageName: text('package_name').notNull(),
    version: text('version').notNull(),
    contentHash: text('content_hash').notNull(),
    ownerId: text('owner_id').notNull(),
    reportedAt: ts('reported_at').notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.registry, table.packageName, table.version, table.contentHash, table.ownerId] }),
    index('mcp_public_reports_version_idx').on(table.registry, table.packageName, table.version),
  ],
);

export type McpContractRow = typeof mcpContracts.$inferSelect;
export type McpDeploymentRow = typeof mcpDeployments.$inferSelect;
export type McpObservationRow = typeof mcpObservations.$inferSelect;
export type McpChangeEventRow = typeof mcpChangeEvents.$inferSelect;

// ─────────────────────────────────────────────────────────────────────────────
// Account email. Two kinds only, chosen so the inbox stays worth reading:
// URGENT (on by default, rare by construction) and a weekly DIGEST (opt-in).
// ─────────────────────────────────────────────────────────────────────────────

/**
 * One row per account, created the first time anything needs it.
 *
 * No email address here: the sender reads the verified primary from Clerk at
 * send time, so a changed address is never stale and lurq holds no list.
 * `unsubscribe_token` is random rather than derived, so it is revocable and
 * needs no signing secret.
 */
export const notificationPreferences = pgTable('notification_preferences', {
  ownerId: text('owner_id').primaryKey(),
  urgentEmail: boolean('urgent_email').notNull().default(true),
  weeklyDigest: boolean('weekly_digest').notNull().default(false),
  unsubscribeToken: text('unsubscribe_token').notNull().unique(),
  lastDigestAt: ts('last_digest_at'),
  createdAt: ts('created_at').notNull().defaultNow(),
  updatedAt: ts('updated_at').notNull().defaultNow(),
});

/**
 * One row per email. `idempotency_key` is unique, so two workers building the
 * same email cannot both send it, and the same key goes to Resend so a retry of
 * a send that did land is dropped on their side too.
 */
export const notificationDeliveries = pgTable(
  'notification_deliveries',
  {
    id: serial('id').primaryKey(),
    ownerId: text('owner_id').notNull(),
    kind: text('kind').$type<'urgent' | 'digest' | 'channel'>().notNull(),
    /** Set on a channel delivery: the Slack/Discord/Teams/webhook it went to. */
    channelId: integer('channel_id'),
    status: text('status').$type<'pending' | 'sent' | 'failed' | 'skipped'>().notNull(),
    idempotencyKey: text('idempotency_key').notNull().unique(),
    attempts: integer('attempts').notNull().default(0),
    /** Why it failed or was skipped. Our own words, never a recipient address. */
    error: text('error'),
    providerId: text('provider_id'),
    createdAt: ts('created_at').notNull().defaultNow(),
    sentAt: ts('sent_at'),
  },
  (table) => [
    index('notification_deliveries_owner_idx').on(table.ownerId, table.kind, table.createdAt),
    index('notification_deliveries_status_idx').on(table.status, table.createdAt),
  ],
);

/**
 * Which alert went out in which email. The primary key is the item itself
 * (`alert:<id>`, `mcp:<id>`), so claiming it is the dedupe: an item can belong to
 * one email, ever.
 */
export const notificationItems = pgTable(
  'notification_items',
  {
    itemKey: text('item_key').primaryKey(),
    ownerId: text('owner_id').notNull(),
    deliveryId: integer('delivery_id')
      .notNull()
      .references(() => notificationDeliveries.id),
    createdAt: ts('created_at').notNull().defaultNow(),
  },
  (table) => [index('notification_items_delivery_idx').on(table.deliveryId)],
);

export type NotificationPreferencesRow = typeof notificationPreferences.$inferSelect;
export type NotificationDeliveryRow = typeof notificationDeliveries.$inferSelect;

/**
 * Where an account's alerts go besides email: a Slack, Discord or Teams
 * webhook, or a signed JSON webhook.
 *
 * The URL is a credential (anyone holding a Slack webhook URL can post to that
 * channel), so it is stored encrypted, bound to the owner. Removal is soft and
 * wipes both secrets: the row stays as a record that the channel existed.
 */
export const notificationChannels = pgTable(
  'notification_channels',
  {
    id: serial('id').primaryKey(),
    ownerId: text('owner_id').notNull(),
    kind: text('kind').$type<'slack' | 'discord' | 'teams' | 'webhook'>().notNull(),
    label: text('label'),
    urlCiphertext: text('url_ciphertext').notNull(),
    /** Enough of the URL to recognise it: host and the last four characters. */
    urlHint: text('url_hint').notNull(),
    /** Webhook kind only: the HMAC secret receivers verify with. Encrypted. */
    signingSecretCiphertext: text('signing_secret_ciphertext'),
    minSeverity: text('min_severity').$type<Severity>().notNull().default('high'),
    enabled: boolean('enabled').notNull().default(true),
    consecutiveFailures: integer('consecutive_failures').notNull().default(0),
    /** Why lurq switched it off, in words for the owner. Cleared on re-enable. */
    disabledReason: text('disabled_reason'),
    lastDeliveredAt: ts('last_delivered_at'),
    lastError: text('last_error'),
    createdAt: ts('created_at').notNull().defaultNow(),
    updatedAt: ts('updated_at').notNull().defaultNow(),
    deletedAt: ts('deleted_at'),
  },
  (table) => [index('notification_channels_owner_idx').on(table.ownerId)],
);

export type NotificationChannelRow = typeof notificationChannels.$inferSelect;

// ─────────────────────────────────────────────────────────────────────────────
// Builder reports, saved per account.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The last builder report an account ran for each target.
 *
 * One row per (owner, target), overwritten by a rescan: this is a snapshot to
 * come back to, not a history. A scan's drift and advisories go stale in days,
 * so keeping every past copy would be storing numbers nobody should act on.
 * `target` is the normalized key (`login` or `login/repo`, lowercased), so a
 * pasted URL and a typed name land on the same row.
 *
 * The listing columns are copied out of `profile` so the saved list never has
 * to read the whole report.
 */
export const builderScans = pgTable(
  'builder_scans',
  {
    ownerId: text('owner_id').notNull(),
    target: text('target').notNull(),
    login: text('login').notNull(),
    archetype: text('archetype').$type<ArchetypeId>().notNull(),
    avatarUrl: text('avatar_url').notNull(),
    profile: jsonb('profile').$type<BuilderProfile>().notNull(),
    scannedAt: ts('scanned_at').notNull().defaultNow(),
    createdAt: ts('created_at').notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.ownerId, table.target] }),
    index('builder_scans_owner_recent_idx').on(table.ownerId, table.scannedAt),
  ],
);

export type BuilderScanRow = typeof builderScans.$inferSelect;
