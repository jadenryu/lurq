/**
 * Drizzle schema (§8). One denormalized `packages` table feeds all reads (§8.2),
 * plus `sync_runs` (ingestion audit) and `seed_packages` (curated bootstrap list).
 *
 * The `vector` extension must exist before these migrations apply — `db migrate`
 * runs `CREATE EXTENSION IF NOT EXISTS vector` first (pgvector is not created
 * automatically by Drizzle).
 */
import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  customType,
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
  ExportSymbol,
  PeerMeta,
  ScoreBreakdown,
  UsageGuide,
} from '../core/types';

const ts = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' });

/** One row per tracked npm package. */
export const packages = pgTable(
  'packages',
  {
    id: serial('id').primaryKey(),
    name: text('name').notNull().unique(),
    ecosystem: text('ecosystem').notNull().default('npm'),

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
    createdAt: ts('created_at').notNull().defaultNow(),
    updatedAt: ts('updated_at').notNull().defaultNow(),
  },
  (table) => [
    index('packages_category_idx').on(table.category),
    index('packages_health_score_idx').on(table.healthScore),
    // pgvector HNSW index for cosine similarity search (§11).
    index('packages_embedding_idx').using('hnsw', table.embedding.op('vector_cosine_ops')),
    // GIN index for lexical full-text search (§3).
    index('packages_search_vector_idx').using('gin', table.searchVector),
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
    discoveredAt: ts('discovered_at').notNull().defaultNow(),
  },
  (table) => [index('discovery_queue_status_idx').on(table.status)],
);

/**
 * API keys for the hosted HTTP service (docs/lurq-hosted-deployment.md §5). Each
 * user/org gets a key; only its sha256 hash is persisted, so a DB leak never
 * exposes a usable key — the plaintext is shown exactly once at creation.
 * `ownerId` is reserved for future self-serve issuance via the Clerk dashboard.
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
  (table) => [
    uniqueIndex('resolved_closures_pkg_idx').on(table.packageName, table.version),
  ],
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
    /** The org this outcome belongs to (api_keys.owner_id). Null for anonymous /
     *  operator-issued keys. This is what turns the flywheel from a global blob
     *  into a per-org asset — "what did *this* org succeed with." Server-injected
     *  from the authenticated key, never caller-supplied. */
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

export type SyncStatus = 'running' | 'success' | 'partial' | 'failed';

export interface SyncError {
  package: string;
  source: string;
  message: string;
}

export type PackageRow = typeof packages.$inferSelect;
export type NewPackageRow = typeof packages.$inferInsert;
export type SeedPackageRow = typeof seedPackages.$inferSelect;
export type SyncRunRow = typeof syncRuns.$inferSelect;
export type DiscoveryQueueRow = typeof discoveryQueue.$inferSelect;
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
