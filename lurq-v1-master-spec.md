# lurq — v1 Master Build Specification

> **Purpose of this document:** This is a complete, self-contained build spec for **lurq v1**. It is written to be handed directly to Claude Code (or another agentic coding assistant) so that the full v1 can be implemented from this document alone. Make concrete decisions where this doc leaves a choice open, follow the build order in §18, and treat the Non-Goals (§4) as hard boundaries — do **not** build anything listed there in v1.

---

## 0. Revision log

> Changes agreed with the product owner *during* the build are recorded here so this doc stays the source of truth. Newest first.

- **2026-06-20 — R1 (build kickoff refinements).** Captured before/during M0–M1:
  1. **Three co-equal surfaces, not "MCP-first."** The MCP server, the CLI, and the agent skill are co-equal delivery surfaces over one engine. The CLI is a first-class product, not just a testing/cron harness. (Revises §1, §3.)
  2. **Anti-reinvention value prop.** A core CLI/agent workflow is "don't rebuild what already exists": describe functionality you're about to implement and lurq tells you whether a proven package already does it — saving time, tokens, and maintenance. Served by `recommend`. (Adds to §2/§3.)
  3. **Companion model.** lurq recommends + explains; the calling agent completes the code. lurq supplies building blocks slot-by-slot; the agent assembles the architecture. Not an architecture oracle, not a stack-assembler (held to §4 non-goals).
  4. **Own recommendation system is the moat; Context7 is optional enrichment only.** lurq must fully recommend + explain from its own ingested, README-grounded data even when Context7 (or any external docs tool) is absent. Context7 may enrich the *exact current API* portion of a usage guide when available, but is never a dependency. (Refines §11, §9.6.)
  5. **Explainer, not just ranker — usage guides.** Each package gets a structured usage guide generated at ingest (what it is / when & why to use / when not to / where it fits / how to wire it in), surfaced in the `evaluate` tool for v1; a dedicated guide/explain tool may follow later. (Extends §9.6 and §12.3.2.)
  6. **Build/operational decisions (open choices resolved):** npm instead of pnpm (pnpm not present; §7 allows npm); local deterministic embedding fallback so search/sync/tests run without paid keys (§7/§11/§15); Bundlephobia kept but strictly best-effort (§9.5); efficiency computed in a **second pass** after category medians are known, and its weight **redistributed** for non-frontend categories (resolves §9.7-vs-§10 ordering and the §10 open choice).
  7. **Schema additions/tweaks (M1):** added a `usage_guide` jsonb column to `packages` (for the explainer guide, item 5). Made `data_as_of` **nullable** rather than `not null` (§8.1) so a package can exist in a partially-ingested state without violating the schema; the sync pipeline always sets it on a successful upsert. Seed list shipped at **230 packages** across all 22 categories (utility tier largest, for the anti-reinvention workflow). `lurq db migrate` also loads the seed list (idempotent), satisfying §19.1.
  9. **Pipeline + scoring notes (M3):** (a) **Weekly downloads are fetched in BULK** (npm point API, 128 packages/call) — per-package bursts get HTTP 429'd hard; the `api.npmjs.org` host is throttled to 1 concurrent / 250ms and weekly failures are now surfaced (not silently nulled). Growth (range API, no bulk form) is a per-package best-effort signal. (b) **`dependents_count` is not collected in v1** (no cheap reliable source); its adoption sub-signal is simply absent. (c) **Two honest limitations to know:** without `GITHUB_TOKEN`, maintenance is computed from npm release-recency only (no release cadence / issue-close-ratio / archived flag), which **under-scores stable-but-quiet packages** (e.g. clsx: 103M downloads but maintenance 0 because its last release was ~2y ago). And the confidence model can't distinguish "stable/done" from "abandoned" — both read as "no recent release." Setting `GITHUB_TOKEN` materially improves maintenance signals; setting `SUMMARY_API_KEY` upgrades the fallback usage guides to real LLM-generated ones. (d) Full seed sync runs in ~2 min, idempotent, recording a `sync_runs` row.
  8. **Ingestion notes (M2), live-validated against real APIs:** (a) `download_growth_90d` (§9.2) uses an explicit `YYYY-MM-DD:YYYY-MM-DD` range — npm's range API rejects a named `last-90-days` period. (b) The npm packument `readme` field is frequently empty (e.g. `zod`), so summary/usage-guide generation in M3 must fall back to the **GitHub raw README** (§9.6 already allows this). (c) deps.dev scorecard + advisories and Bundlephobia all confirmed working; GitHub degrades cleanly to null without a token. (d) Persistent HTTP cache lives on disk at `$LURQ_CACHE_DIR` (default `~/.cache/lurq/http`) — chose on-disk over a `http_cache` table (§17 offered either).

## 1. One-line summary

lurq is a **continuously-updated, evidence-scored index of software frameworks and libraries**, exposed through **three co-equal surfaces — an MCP server, a CLI, and an installable agent skill** — so that agentic AI coding assistants (Claude Code, Cursor, Copilot) **and developers directly** can query it for **current, objective** recommendations when choosing dependencies — or to check whether a proven package already exists *before building something from scratch* — instead of relying on stale, marketing-biased training knowledge.

## 2. Why lurq exists (the wedge — keep this in mind while building)

AI coding assistants choose frameworks from training data that is (a) frozen at a cutoff date and (b) biased toward whatever had the most blog/marketing content written about it. lurq's entire reason to exist in v1 is to supply the two things the assistant lacks:

1. **Freshness** — framework/version data newer than any model cutoff, refreshed on a schedule.
2. **Objectivity** — health/adoption/maintenance scores computed from real public signals, not popularity-of-mentions.

Every design decision should protect these two properties. If a feature doesn't make recommendations *fresher* or *more objective* than what the calling agent already knows, it does not belong in v1.

## 3. Positioning (do not violate)

- lurq is **a companion an agent (or developer) consults**, not a competing chat UI or a replacement for the agent. When called by an agent it never has the user's code context; the agent does. lurq supplies knowledge the caller lacks — including *"a proven package already does this, don't hand-roll it"* — and returns it for the caller to use.
- **Three co-equal surfaces over one engine** (revised in §0/R1): (1) the **MCP server** — the deepest integration, inside the agent's loop; (2) the **CLI** — a first-class app for developers, scripts, and CI, useful standalone with no agent attached (e.g. `lurq recommend "debounce a function"`); (3) the **agent skill** — one-command installation into supported assistants. The CLI is *not* merely a testing/cron harness.
- Responses must be **compact and structured** (see §12.4). Bloated tool payloads make the calling agent worse, not better.

## 4. v1 scope

### In scope (build these)
- A data ingestion pipeline pulling from **public APIs only** (§9).
- A Postgres database (with pgvector) storing framework/library metadata, computed scores, and embeddings (§8).
- A **health/adoption/reliability scoring model** with **confidence labels** (`proven` / `emerging` / `unproven`) (§10).
- **Semantic search** over package descriptions/summaries so a natural-language need maps to candidates (§11).
- An **MCP server** exposing 4 core tools + 1 optional tool (§12).
- A **CLI** mirroring the core operations + a sync command + a skill installer (§13–14).
- Coverage of **exactly one ecosystem: the JavaScript / TypeScript web stack** (npm). Nothing else.

### Non-goals (DO NOT build in v1 — these are future roadmap, §20)
- ❌ The outcome-data flywheel / tracking performance of apps that used lurq.
- ❌ Any embedded runtime telemetry, SDK-in-user-app, or observability features.
- ❌ Any web-scraping. Public structured APIs only.
- ❌ Additional ecosystems (Python/PyPI, Rust/crates, etc.).
- ❌ A full "architecture oracle." Architecture help in v1 is limited to the optional `diagram` tool emitting a reference-pattern Mermaid diagram (§12.3.5).
- ❌ Indexing "startups / agent-native infra products" (e.g. InsForge-style tools). Frameworks/libraries only in v1.
- ❌ A web UI / dashboard.
- ❌ User accounts, auth, multi-tenancy, billing.

## 5. Guiding principles

1. **Freshness + objectivity over everything** (§2).
2. **One ecosystem, deep** beats many ecosystems, shallow.
3. **Never overclaim.** A package is only labeled `proven` when the evidence supports it. Honest confidence labeling is a core feature, not a disclaimer.
4. **APIs, not scraping.**
5. **Compact MCP responses.** Hard ceiling guidance in §12.4.
6. **Library/dependency selection is the tractable v1 job.** Whole-architecture recommendation is deferred.
7. Every stored record and every tool response carries a **`dataAsOf` timestamp** so the agent knows the data is current.

## 6. Architecture overview

```
                 ┌─────────────────────────────────────────────┐
                 │                  lurq                         │
                 │                                               │
  Public APIs    │   ┌───────────┐   ┌──────────┐   ┌────────┐  │
  (npm, GitHub,  │──▶│ Ingestion │──▶│ Scoring  │──▶│  DB     │  │
  deps.dev,      │   │ pipeline  │   │ +confid. │   │ Postgres│  │
  Bundlephobia)  │   └───────────┘   └──────────┘   │ +pgvec  │  │
                 │         │                         └────┬────┘  │
                 │         ▼ (embeddings)                 │       │
                 │   ┌───────────┐                        │       │
                 │   │ Embeddings│────────────────────────┘       │
                 │   └───────────┘                                │
                 │                                                │
                 │   ┌──────────────┐        ┌───────────────┐    │
                 │   │  MCP server  │        │     CLI       │    │
                 │   │ (stdio)      │        │ (commander)   │    │
                 │   └──────┬───────┘        └───────┬───────┘    │
                 └──────────┼────────────────────────┼───────────┘
                            │                        │
                  Claude Code / Cursor /       Human / cron /
                  Copilot (calls tools)        CI (runs commands)
```

Components: **ingestion** (source clients + pipeline), **scoring** (health score + confidence), **search** (embeddings + vector query), **db** (schema + queries), **mcp** (server + tool handlers), **cli** (commands + skill installer), **core** (types, config, http client).

## 7. Tech stack (opinionated — use these unless a hard blocker arises)

| Concern | Choice | Notes |
|---|---|---|
| Language/runtime | **TypeScript on Node.js (LTS, ≥20)** | Matches target ecosystem; MCP SDK is TS. |
| Package manager | **pnpm** | Fast, deterministic. npm acceptable. |
| MCP server | **`@modelcontextprotocol/sdk`** | stdio transport for local agent use. |
| CLI framework | **commander** | Simple, well-known. |
| Database | **PostgreSQL + `pgvector`** | One DB for structured data *and* vectors — no separate vector store in v1. |
| ORM / query | **Drizzle ORM** | TS-first, lightweight, native pgvector support. Prisma acceptable alternative. |
| Embeddings | **provider interface, default OpenAI `text-embedding-3-small` (1536-dim)** | Pluggable; allow a local-model implementation later. |
| HTTP client | native `fetch` (Node ≥20) wrapped in a rate-limited/cached layer | §17. |
| Scheduling | `lurq sync` command, cron-able; optional `node-cron` worker | Keep simple. |
| Validation | **zod** | Validate MCP tool inputs + external API payloads. |
| Testing | **vitest** | Unit + integration. |
| Distribution | publishable npm package, runnable via **`npx lurq …`** (no global install required) | Mirror the InsForge `npx` pattern. |

## 8. Data model / database schema

Use Drizzle migrations. Target Postgres with the `vector` extension enabled (`CREATE EXTENSION IF NOT EXISTS vector;`).

### 8.1 Tables

**`packages`** — one row per npm package tracked.

| column | type | notes |
|---|---|---|
| `id` | serial PK | |
| `name` | text unique not null | npm package name |
| `ecosystem` | text not null default `'npm'` | v1 always `npm` |
| `category` | text | from taxonomy §8.3; nullable until classified |
| `description` | text | from npm/registry |
| `summary` | text | concise generated blurb (§9.6) |
| `repo_url` | text | resolved GitHub URL if any |
| `homepage` | text | |
| `latest_version` | text | |
| `license` | text | |
| `deprecated` | boolean default false | |
| `archived` | boolean default false | repo archived |
| `first_published_at` | timestamptz | age signal |
| `last_release_at` | timestamptz | maintenance signal |
| `weekly_downloads` | bigint | adoption signal |
| `download_growth_90d` | real | fractional change over 90d |
| `dependents_count` | integer | adoption signal |
| `stars` | integer | weak adoption signal |
| `open_issues` | integer | |
| `closed_issues` | integer | |
| `scorecard` | real | OpenSSF Scorecard 0–10 |
| `bundle_min_gzip_kb` | real | nullable (frontend only) |
| `advisories` | jsonb | array of {id, severity, summary} |
| `health_score` | integer | 0–100 computed (§10) |
| `confidence` | text | `proven`\|`emerging`\|`unproven` |
| `score_breakdown` | jsonb | {maintenance, adoption, reliability, efficiency} sub-scores |
| `embedding` | vector(1536) | of `summary`+`description`+`category` |
| `data_as_of` | timestamptz not null | last successful sync time |
| `created_at` / `updated_at` | timestamptz | |

Indexes: unique on `name`; btree on `category`; ivfflat/hnsw on `embedding` for vector search; btree on `health_score`.

**`sync_runs`** — ingestion audit. Columns: `id`, `started_at`, `finished_at`, `packages_seen`, `packages_updated`, `errors` jsonb, `status`.

**`seed_packages`** — the curated v1 seed list (§16): `name`, `category`, `added_at`. Used to bootstrap ingestion.

### 8.2 Notes
- `embedding` is computed from a normalized text blob: `"${name}. ${category}. ${summary || description}"`.
- All recommendation/eval reads come from this single denormalized `packages` table for speed.

### 8.3 Category taxonomy (v1, JS/TS)
`framework`, `meta-framework`, `state-management`, `routing`, `orm`, `database-client`, `ui-component-library`, `styling`, `forms`, `validation`, `data-fetching`, `http-client`, `auth`, `testing`, `build-tool`, `bundler`, `linting`, `date-time`, `animation`, `charts`, `i18n`, `utility`. Allow `other`. Categories drive filtered recommendation.

## 9. Data sources & ingestion pipeline

**All sources are public APIs. No scraping. No headless browsers.**

### 9.1 npm registry — `https://registry.npmjs.org/{package}`
Provides: latest version, description, license, repository URL, homepage, maintainers, publish times (`time` map → `first_published_at`, `last_release_at`), deprecation flag.

### 9.2 npm downloads — `https://api.npmjs.org/downloads/point/last-week/{package}` and `/range/{period}/{package}`
Provides: `weekly_downloads`; compute `download_growth_90d` from a 90-day range query (last 30d avg vs prior 30d avg).

### 9.3 GitHub API — `https://api.github.com/repos/{owner}/{repo}`
Resolve `{owner}/{repo}` from the npm `repository` field. Provides: `stars`, `open_issues`, `archived`, plus releases (`/releases`) for cadence and issues stats. **Requires a token** (`GITHUB_TOKEN`); authenticated limit ~5000 req/hr — batch and cache. Prefer the GraphQL API to fetch stars + issues + latest release in one call per repo.

### 9.4 deps.dev API — `https://api.deps.dev/v3/systems/npm/packages/{package}`
Provides: versions, dependencies, **OpenSSF Scorecard** (`scorecard`), and **security advisories** (`advisories`). Primary source for `scorecard` and `advisories`.

### 9.5 Bundlephobia — `https://bundlephobia.com/api/size?package={name}`
Provides: minified+gzip size → `bundle_min_gzip_kb`. Frontend categories only (`ui-component-library`, `styling`, `state-management`, `forms`, `validation`, `data-fetching`, `charts`, `animation`, `date-time`, `utility`). Null for backend-only packages. Cache aggressively; this API can be slow/rate-limited.

### 9.6 Summary generation (the "summarize frameworks" feature)
At ingest, generate a concise **2–3 sentence summary** per package answering *what it is, when to use it, and how it typically fits into an app*. Implementation: take the README (npm registry / GitHub raw `README.md`) + description and run a single LLM summarization call (provider-configurable; reuse the embeddings provider's chat endpoint or a small model). Store in `packages.summary`. If no LLM key is configured, fall back to the npm `description`. Keep summaries factual; do not invent capabilities.

### 9.7 Pipeline flow (`lurq sync`)
For each package in `seed_packages` (and their notable dependents, optional):
1. Fetch npm registry → base metadata.
2. Fetch npm downloads (week + 90d range) → adoption.
3. Resolve repo → GitHub (GraphQL) → maintenance signals.
4. Fetch deps.dev → scorecard + advisories.
5. If frontend category → Bundlephobia → bundle size.
6. Generate/refresh summary (§9.6).
7. Compute `health_score`, `score_breakdown`, `confidence` (§10).
8. Compute `embedding` (§11).
9. Upsert into `packages` with fresh `data_as_of`.
Record a `sync_runs` row. Pipeline must be **idempotent**, resumable, and tolerant of individual source failures (skip a signal, don't fail the package; record the error).

### 9.8 Cadence
Default full sync **daily**. `lurq sync` is cron-able. Respect all rate limits with the cached/backoff HTTP layer (§17).

## 10. Scoring & confidence model (v1 heuristics — tunable; keep weights in one config file)

All sub-scores normalized to **0–100**. Composite:

```
health_score = round(
    0.35 * maintenance +
    0.30 * adoption +
    0.25 * reliability +
    0.10 * efficiency
)
```

**maintenance** (0–100): combine
- recency of `last_release_at` (≤30d → 100, decaying to 0 by ~24 months),
- release cadence (releases in last 12 months, capped),
- issue close ratio `closed/(open+closed)`,
- hard penalties: `deprecated` or `archived` → maintenance capped at 15.

**adoption** (0–100): combine
- `log10(weekly_downloads)` scaled (e.g. 10 dl→low, 10M dl→100),
- `download_growth_90d` bonus (growth adds, decline subtracts),
- `dependents_count` (log-scaled),
- `stars` (small weight only).

**reliability** (0–100):
- `scorecard * 10` (OpenSSF 0–10 → 0–100),
- minus advisory penalties by severity (critical −40, high −20, moderate −8 each, floored at 0).

**efficiency** (0–100): frontend categories only — score inversely vs the **category median** bundle size (smaller than median → higher). For non-frontend categories, set efficiency = the package's own maintenance score (neutral) and document that it's not size-based, OR redistribute its 0.10 weight into maintenance. Pick one and keep it consistent; document the choice in code.

**Confidence label** (independent of score; about *trustworthiness of the evidence*):
- `proven` — `weekly_downloads ≥ 100_000` **and** age ≥ 12 months **and** `last_release_at` ≤ 6 months ago **and** no critical/high advisories.
- `emerging` — not proven, but (`weekly_downloads ≥ 5_000` **or** strong positive `download_growth_90d`) **and** maintained (release ≤ 9 months).
- `unproven` — everything else (very new, low adoption, sparse data, or unmaintained).

Never present an `unproven` package as if it were established. `recommend`/`evaluate` responses always include the confidence label.

## 11. Semantic search

- On ingest, embed the normalized text blob (§8.2) via the configured provider (default `text-embedding-3-small`, 1536-dim) → `packages.embedding`.
- `recommend(need)` embeds the user's NL need, runs a pgvector similarity query (cosine), optionally pre-filtered by inferred `category`, then **re-ranks** candidates by a blend of similarity and `health_score` (e.g. `0.6*similarity_norm + 0.4*health_score/100`). Return top N (default 3, max 5).
- Category inference: lightweight keyword/zero-shot mapping of the need to the taxonomy (§8.3); if uncertain, search across all categories.

## 12. MCP server

### 12.1 Transport
stdio (the standard for local agent integration). Started via `lurq serve` or directly as the package bin. Expose a clear server name/version.

### 12.2 Input validation
Validate every tool input with zod. Return structured errors, never throw raw.

### 12.3 Tools

#### 12.3.1 `recommend`
Pick the best current libraries for a described need.
- **Input:** `{ need: string, category?: <taxonomy>, constraints?: { runtime?: "browser"|"node"|"both", license?: string, maxBundleKb?: number, minConfidence?: "proven"|"emerging"|"unproven" } }`
- **Output:** `{ dataAsOf: string, candidates: Candidate[] }` where `Candidate = { name, category, healthScore, confidence, why, latestVersion, weeklyDownloads, lastReleaseAt, repoUrl }`. `why` is ≤ 1 sentence. Max 5 candidates.

#### 12.3.2 `evaluate`
Full evidence read on one package.
- **Input:** `{ package: string }`
- **Output:** `{ dataAsOf, name, category, healthScore, confidence, scoreBreakdown: {maintenance, adoption, reliability, efficiency}, latestVersion, lastReleaseAt, weeklyDownloads, downloadGrowth90d, dependentsCount, scorecard, bundleMinGzipKb, deprecated, archived, advisories: [{id, severity, summary}], summary, repoUrl }`. If not tracked, return `{ tracked: false, suggestion }` (see §12.5).

#### 12.3.3 `compare`
- **Input:** `{ packages: string[] }` (2–5)
- **Output:** `{ dataAsOf, rows: EvaluateOutput[] }` — array of the per-package evaluation, ordered by `healthScore` desc. Keep each row compact.

#### 12.3.4 `verify` (dependency-safety / anti-hallucination)
Confirm a package the agent is about to install is real and healthy — guards against hallucinated / slopsquatted dependency names.
- **Input:** `{ package: string }`
- **Output:** `{ exists: boolean, tracked: boolean, deprecated: boolean, archived: boolean, latestVersion: string|null, weeklyDownloads: number|null, riskFlags: string[], confidence, advisoryCount: number }`. `exists` is checked live against the npm registry (not just the local DB) so brand-new-but-real and never-existed names are distinguished. `riskFlags` examples: `"not-found-on-registry"`, `"zero-downloads"`, `"published-within-7-days"`, `"single-maintainer"`, `"has-known-advisory"`.

#### 12.3.5 `diagram` (OPTIONAL — include only after 12.3.1–12.3.4 work)
Emit a reference-architecture Mermaid diagram for a chosen stack. Lightweight; uses built-in reference patterns keyed by the packages/categories provided. Not an "architecture oracle."
- **Input:** `{ stack: string[] }` (package names) or `{ description: string }`
- **Output:** `{ mermaid: string, note: string }`.

### 12.4 Response-size discipline (hard requirement)
- Tool responses must be small. Target **< 1,500 tokens** per response; never dump full READMEs, full dependency trees, or raw API payloads.
- `recommend` returns ≤ 5 candidates with one-line `why` only.
- Truncate `summary` to ~3 sentences; truncate advisory lists to the top 5 by severity.
- Always include `dataAsOf`.

### 12.5 "Not tracked" behavior
If a queried package isn't in the DB but **exists on npm**, do a **live on-demand fetch + score** for that single package, store it, and return it (this also organically grows coverage beyond the seed). If it doesn't exist on npm, say so plainly (critical for `verify`).

## 13. CLI (`lurq`)

Runnable via `npx lurq <command>`. Commands mirror the MCP tools plus operations:

- `lurq serve` — start the MCP server (stdio).
- `lurq sync [--full] [--package <name>]` — run ingestion (all seed packages, or one).
- `lurq recommend "<need>" [--category <c>] [--min-confidence <c>]` — pretty-printed table.
- `lurq evaluate <package>` — detailed read.
- `lurq compare <pkgA> <pkgB> [...]` — side-by-side table.
- `lurq verify <package>` — safety check.
- `lurq install-skill [--agent claude-code|cursor|copilot|windsurf|all]` — §14.
- `lurq db migrate` / `lurq db reset` — schema management.

Human-facing output uses a compact table; add `--json` to every command for machine output.

## 14. Agent skill installer

Mirror the InsForge pattern: a one-command install that registers lurq with supported assistants so they auto-discover the tools.
- `lurq install-skill --agent claude-code` writes the MCP server entry into the agent's config (e.g. an `mcpServers` entry pointing at `npx lurq serve`) and drops a short skill/instructions file telling the agent *when* to call lurq (before choosing or installing any dependency; to verify any package name before install).
- Support `claude-code`, `cursor`, `copilot`, `windsurf`; `--agent all` does each detected one. Detect config locations; never overwrite unrelated config — merge.
- Ship the instruction text as a template in the repo.

## 15. Configuration (env vars)

| var | required | purpose |
|---|---|---|
| `DATABASE_URL` | yes | Postgres connection (pgvector-enabled). |
| `GITHUB_TOKEN` | yes (for full signals) | GitHub API auth (raises rate limit). |
| `EMBEDDING_PROVIDER` | no (default `openai`) | embeddings backend. |
| `EMBEDDING_API_KEY` | yes if provider needs it | e.g. OpenAI key. |
| `SUMMARY_PROVIDER` / `SUMMARY_API_KEY` | no | LLM summary (§9.6); falls back to npm description if absent. |
| `LURQ_SYNC_CONCURRENCY` | no (default 5) | parallel ingest workers. |
| `LOG_LEVEL` | no | |

Provide `.env.example`. Fail fast with a clear message if a required var is missing.

## 16. Seed data strategy

v1 must be useful immediately, so ship a **curated seed list** (~150–300 packages) covering the JS/TS web stack across every category in §8.3 — e.g. the leading 5–15 packages per category (frameworks, meta-frameworks, state, routing, ORMs, UI libs, styling, forms, validation, data-fetching, http, auth, testing, build tools, etc.). Store it as `seed.json` loaded into `seed_packages`. `lurq sync` populates real scores for all of them. Coverage then grows organically via the on-demand path (§12.5). Do **not** hand-write scores — every score must come from the live pipeline.

## 17. HTTP layer, caching, freshness, errors

- Single shared fetch wrapper: per-host rate limiting, exponential backoff on 429/5xx, in-run response caching, and a persistent cache (e.g. a `http_cache` table or on-disk) with per-source TTLs (registry 6h, downloads 12h, GitHub 12h, deps.dev 24h, Bundlephobia 7d).
- Every package row and every tool response carries `dataAsOf`. If data for a package is older than a staleness threshold (e.g. 7 days), tool responses include a `stale: true` hint.
- Source failures degrade gracefully: a missing signal lowers confidence/score completeness but never crashes ingestion. Log to `sync_runs.errors`.

## 18. Build order / milestones (implement in this sequence)

- **M0 — Scaffold.** TS project, pnpm, vitest, lint, `.env.example`, package structure per §6, `npx`-runnable bin.
- **M1 — DB.** Postgres + pgvector, Drizzle schema (§8), migrations, `lurq db migrate`, load `seed.json` into `seed_packages`.
- **M2 — Ingestion clients.** npm registry, npm downloads, GitHub (GraphQL), deps.dev, Bundlephobia — each behind the shared HTTP layer (§17), each unit-tested against recorded fixtures.
- **M3 — Pipeline + scoring.** `lurq sync` end-to-end for the seed list; implement §10 scoring + confidence into `packages`.
- **M4 — Embeddings + search.** Embedding provider interface + default; embed on ingest; pgvector similarity + re-rank (§11).
- **M5 — MCP server.** `lurq serve`; implement `recommend`, `evaluate`, `compare`, `verify` with zod validation, compact responses (§12.4), and on-demand fetch (§12.5).
- **M6 — CLI.** All human commands (§13) with table + `--json` output.
- **M7 — Skill installer.** `lurq install-skill` for Claude Code first, then others (§14).
- **M8 — Optional `diagram` tool**, polish, README, tests.

Each milestone should end with passing tests and a working demo command.

## 19. v1 acceptance criteria ("done")

v1 is complete when all of the following are true:
1. `lurq db migrate` + `lurq sync` populates the full seed list with real, source-derived scores and confidence labels, recording a `sync_runs` row.
2. From a fresh clone with env configured, `npx lurq serve` starts an MCP server that Claude Code can connect to via `lurq install-skill --agent claude-code`.
3. In Claude Code, asking it to pick e.g. "a form library for a React app" causes it to call `recommend` and receive ≤ 5 current candidates with health scores + confidence + `dataAsOf`, in < 1,500 tokens.
4. `verify` correctly distinguishes (a) a real popular package, (b) a real brand-new package, and (c) a non-existent/hallucinated name.
5. `evaluate` and `compare` return the documented compact shapes.
6. A package not in the seed list, when queried, is fetched on demand, scored, stored, and returned.
7. Ingestion tolerates a single-source outage without failing the run.
8. All tests pass; README documents setup, env, and the install-skill flow.

## 20. Post-v1 roadmap (explicitly NOT built now — context only)

These are the intended directions *after* v1 ships and earns adoption; do not implement them in v1:
1. **Outcome-data flywheel.** Start with public-proxy tracking (watch the public trajectory of projects that adopted recommended packages), later (and only with explicit consent + privacy design) embedded runtime telemetry — the proprietary signal that becomes the real moat. This is a separate, heavier product and a deliberate later phase.
2. **More ecosystems** (PyPI, crates.io, etc.) once JS/TS is excellent.
3. **Architecture recommendation** beyond reference-pattern diagrams, once outcome data can ground it.
4. **Indexing agent-native infra / dev-tool "startups"** (InsForge-style CLI/MCP products) as first-class records alongside libraries.

## 21. Notes on what makes lurq defensible (for the builder, not the build)

At v1 the moat is thin because the underlying data is public — anyone could pull it. v1 wins instead on **depth in one ecosystem, freshness, objective scoring, and ergonomics inside the agent loop**, and on earning the adoption that later makes the outcome-data flywheel (§20.1) possible. Build v1 to be the fastest, most current, most honest dependency-picker an agent can call — not to be everything at once.
