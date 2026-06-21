# lurq — Application Walkthrough (v1)

> A technically detailed tour of the entire codebase as it stands today. Companion to
> `lurq-v1-master-spec.md` (the build spec) and `lurq-feature-roadmap.md` (the strategy layer).
> This document explains *what is built and how it works*, file by file and subsystem by subsystem.

> **How to read this document.** The main text is written for engineers and stays fully technical.
> Wherever a section uses terms a newcomer to programming might not know, it is followed by a
> **🟢 Plain-language primer** box that defines the jargon and explains the idea from scratch. If
> you're already fluent, skip the green boxes; if you're new, read them right after the section they
> follow.

---

## 1. What lurq is

lurq is an **objective recommendation + evaluation layer for npm packages**, designed to be called by
an AI coding agent at the exact moment it chooses or wires up a dependency. It is shipped three ways
from one codebase:

- an **MCP server** (`lurq serve`, stdio) exposing 5 tools to agents,
- a **CLI** (`npx lurq <command>`) for humans, mirroring the same tools, and
- an **agent skill installer** (`lurq install-skill`) that registers the MCP server into supported
  assistants.

The core identity: lurq never sees your source code. It supplies fresh, objectively-scored,
explained library knowledge that the model's training data lacks — and it picks libraries
**slot-by-slot** (a form library, an ORM), explicitly *not* designing whole architectures (that's a
declared non-goal).

**v1 scope:** the JavaScript/TypeScript web stack (npm) only.

> **🟢 Plain-language primer**
>
> - **npm package** — a reusable chunk of pre-written JavaScript code that other people publish so you
>   don't have to write it yourself (e.g. `react`, `lodash`). "npm" is the public warehouse these are
>   downloaded from. A "dependency" is just an npm package your project depends on.
> - **AI coding agent** — a program like Claude Code, Cursor, or Copilot that writes code on your
>   behalf. When it needs a library, it can *call out* to a tool like lurq to get a fresh, factual
>   recommendation instead of relying on its (frozen, possibly outdated) memory.
> - **MCP server** — MCP (Model Context Protocol) is a standard way for AI agents to call external
>   tools. An "MCP server" is a program that advertises a menu of tools (here: `recommend`, `verify`,
>   …) the agent can invoke. lurq *is* such a server.
> - **stdio** — "standard input/output," the plain text channel a program reads from and writes to.
>   The agent and lurq talk over this channel rather than over a network port — simple and local.
> - **CLI** — "command-line interface": a program you run by typing commands into a terminal (e.g.
>   `lurq recommend "a form library"`). Same logic as the MCP tools, but for humans.
> - **"slot-by-slot"** — lurq fills one decision at a time ("which form library?") rather than
>   designing your whole app's architecture. That bigger job is deliberately *out of scope*.

---

## 2. The problem it solves

Three forces motivate the design:

1. **Training-cutoff bias (the "Matthew effect").** LLMs are structurally biased toward whatever was
   popular at training time, and generate better code for popular frameworks. An objective, *fresh*
   signal corrects that bias.
2. **Slopsquatting.** Agents hallucinate plausible-but-fake package names, which attackers register
   for real. The `verify` tool is the anti-hallucination guard.
3. **Dead-package recommendations.** Agents confidently suggest abandoned packages (Moment.js,
   `request`) because they were popular at cutoff. Freshness + maintenance scoring catches this.

> **🟢 Plain-language primer**
>
> - **Training cutoff** — an AI model is "frozen" at the date its training data ends. It has no idea
>   what happened in the package ecosystem after that date, so its advice can be stale.
> - **Hallucinate** — when an AI confidently makes something up that sounds real but isn't — here, a
>   package name that doesn't actually exist.
> - **Slopsquatting** — attackers notice which fake names AIs tend to hallucinate, then *register*
>   those names with malicious code inside, so the hallucination becomes a real (poisoned) package.
>   `verify` checks a name against reality before you install it.

---

## 3. Tech stack & conventions

| Concern | Choice |
|---|---|
| Language / runtime | TypeScript (ESM), Node ≥ 20 |
| MCP | `@modelcontextprotocol/sdk` ^1.29 (stdio transport) |
| CLI | `commander` ^12 |
| DB / ORM | PostgreSQL + `pgvector`, `drizzle-orm` ^0.45 over `postgres` (postgres.js) |
| Validation | `zod` ^3 (env config, MCP input schemas, seed file) |
| Build | `tsup` (bundles to `dist/`) |
| Dev runner | `tsx` (`npm run dev -- <command>`) |
| Tests | `vitest` — **81 tests across 12 files**, all green |
| Lint / format | eslint (typescript-eslint), prettier |

**Codebase size:** ~3,934 lines of source TypeScript across ~42 files. The code is heavily commented
with spec section references (e.g. `§9.7`, `§12.4`) tying each module back to the master spec.

Key conventions observed throughout:
- **Pure functions take an explicit `now: Date`** for deterministic testing (all of scoring).
- **Every external signal is nullable** and degrades gracefully — no single source failure crashes
  ingestion.
- **Dependency injection of `fetchImpl`** everywhere HTTP happens, so tests inject a fake `fetch`.
- **Providers are pluggable interfaces** (embeddings, summaries) with a zero-credentials local fallback.

> **🟢 Plain-language primer**
>
> - **TypeScript** — JavaScript with a type system bolted on. "Types" let you declare that a value is,
>   say, a number or a `Category`, and the compiler catches mismatches *before* the code runs. **ESM**
>   ("ECMAScript Modules") is the modern `import`/`export` syntax for splitting code into files.
> - **Runtime** — the program that actually executes the code. **Node** (Node.js) runs JavaScript
>   outside a browser, e.g. on a server or your laptop. "Node ≥ 20" means version 20 or newer.
> - **DB / ORM** — a **database** stores data permanently. **PostgreSQL** ("Postgres") is the specific
>   database used here. An **ORM** ("object-relational mapper," here `drizzle-orm`) lets you read/write
>   the database using normal code objects instead of writing raw SQL by hand. **pgvector** is a
>   Postgres add-on that stores AI "embedding" vectors and finds similar ones (see §9).
> - **Validation / `zod`** — checking that incoming data has the expected shape. `zod` is a library
>   that describes a shape once and then both checks data against it and gives you the matching type.
> - **Build / bundle / `tsup`** — TypeScript can't run directly; it must be "compiled" into plain
>   JavaScript. A **bundler** (`tsup`) does that and packs the files into a `dist/` folder for shipping.
> - **`tsx`** — a tool that runs TypeScript directly during development, skipping the build step.
> - **`vitest`** — the **test** framework. "Tests" are small scripts that automatically check the code
>   does what it should; "all green" means every test passed.
> - **Lint / format** — `eslint` flags suspicious code; `prettier` auto-formats it consistently. Both
>   keep the codebase tidy without manual effort.
> - **Pure function** — a function whose output depends *only* on its inputs and which changes nothing
>   else. Passing the current time in as an argument (`now`) instead of reading the clock inside makes
>   it pure, so a test can feed a fixed date and get a predictable answer ("deterministic").
> - **Nullable** — a value that is allowed to be "nothing" (`null`). Marking every external signal
>   nullable means the code is written to cope when a data source is missing.
> - **Dependency injection** — instead of a function reaching out and grabbing a tool itself, you hand
>   the tool to it as an argument. Here the network function `fetch` is injected, so tests can pass a
>   *fake* `fetch` and avoid hitting the real internet.
> - **Pluggable interface** — a contract ("anything that can do X") that multiple implementations can
>   satisfy. lurq can swap a paid cloud "provider" for a free local one because both honor the same
>   interface.

---

## 4. Project layout

```
src/
  bin/lurq.ts            # CLI entry point (#!/usr/bin/env node)
  index.ts               # library exports
  core/                  # cross-cutting infrastructure
    config.ts            #   zod-validated env, getConfig/requireConfig
    constants.ts         #   server name, EMBEDDING_DIM, cache TTLs, staleness
    http.ts              #   the shared HTTP layer: rate-limit + cache + retry
    concurrency.ts       #   pMap (bounded-concurrency map)
    logger.ts, paths.ts  #   leveled logger; resolves seed.json / migrations / templates
    types.ts             #   category taxonomy + all domain types
  db/                    # persistence
    schema.ts            #   drizzle tables: packages, sync_runs, seed_packages
    client.ts            #   postgres.js + drizzle factory (owns lifecycle)
    packages.ts          #   read/write helpers + sync_runs audit
    migrate.ts           #   db migrate / db reset (creates pgvector ext)
    seed.ts              #   load curated seed.json into seed_packages
  ingestion/             # gather raw signals from public APIs
    collect.ts           #   fault-isolated multi-source gather for one package
    types.ts             #   normalized per-source shapes
    summarize.ts         #   LLM or fallback usage-guide generation
    sources/             #   one client per API
      npmRegistry.ts, npmDownloads.ts, github.ts,
      githubReadme.ts, depsDev.ts, bundlephobia.ts
  scoring/               # the evidence → score model
    score.ts             #   pure scoring functions (maintenance/adoption/…)
    weights.ts           #   ALL tunable weights & thresholds in one file
  search/                # recommendation
    embeddings.ts        #   OpenAI or local deterministic embedder
    recommend.ts         #   pgvector cosine search + health re-rank
    categoryInference.ts #   keyword → taxonomy category
  pipeline/              # orchestration
    sync.ts              #   two-pass bulk ingestion (the `sync` command)
    single.ts            #   on-demand single-package fetch+score (§12.5)
  mcp/                   # the MCP surface
    server.ts            #   registers 5 tools, zod schemas, stdio transport
    handlers.ts          #   recommend/evaluate/compare/verify (pure over a Database)
    diagram.ts           #   optional reference-architecture diagram (stack-only)
  cli/                   # the human surface
    index.ts             #   commander wiring (final command shape)
    commands.ts          #   table/detail rendering over the MCP handlers
    format.ts            #   table/color helpers
    installSkill.ts      #   merge lurq MCP entry into agent configs
  data/seed.json         # 230 curated seed packages
templates/skill-instructions.md   # the "when to call lurq" guide installed for agents
drizzle/                 # generated SQL migration + snapshot
```

> **🟢 Plain-language primer**
>
> - This is a **directory tree** — folders (ending in `/`) containing files. Indentation shows nesting.
>   `src/` ("source") holds the code that engineers write; `dist/` (not shown) holds the compiled
>   output that actually ships.
> - **File extensions:** `.ts` = TypeScript code, `.json` = structured data, `.md` = Markdown text
>   (like this document), `.sql` = database commands.
> - **The `#` comments** after each path are notes explaining what that file does.
> - **Separation of concerns** — notice each folder has one job: `db/` only talks to the database,
>   `scoring/` only computes scores, `cli/` only handles the terminal interface. Keeping these apart
>   makes the system easier to understand and change one piece at a time.

---

## 5. The data model (`src/db/schema.ts`)

lurq is built on **one denormalized read table** plus two supporting tables. Everything the
recommendation/evaluation reads come from a single `packages` row — no joins on the hot path.

### `packages` — one row per tracked npm package

Columns group into:
- **Identity/classification:** `name` (unique), `ecosystem` (default `npm`), `category` (the taxonomy
  type), `description`, `summary`, `repoUrl`, `homepage`, `latestVersion`, `license`.
- **Lifecycle flags:** `deprecated`, `archived`.
- **Age/maintenance signals:** `firstPublishedAt`, `lastReleaseAt`.
- **Adoption signals:** `weeklyDownloads` (bigint), `downloadGrowth90d` (real), `dependentsCount`,
  `stars`, `openIssues`, `closedIssues`.
- **Reliability/efficiency signals:** `scorecard` (OpenSSF, 0–10), `bundleMinGzipKb`, `advisories`
  (jsonb).
- **Computed outputs:** `healthScore` (int), `confidence` (`proven|emerging|unproven`),
  `scoreBreakdown` (jsonb sub-scores), `usageGuide` (jsonb), `embedding` (`vector(1536)`).
- **Freshness/bookkeeping:** `dataAsOf`, `createdAt`, `updatedAt`.

Indexes: `category`, `healthScore`, and a **pgvector HNSW index** on `embedding` using
`vector_cosine_ops` for semantic search.

### `sync_runs` — ingestion audit trail

Every `sync` writes a row: `startedAt`/`finishedAt`, `packagesSeen`, `packagesUpdated`, `errors`
(jsonb array of `{package, source, message}`), and `status` (`running|success|partial|failed`).

### `seed_packages` — the curated bootstrap list

`name` (PK), `category`, `addedAt`. Loaded from `src/data/seed.json` (**230 packages**) at migrate
time; `sync` reads this to know what to ingest.

**pgvector note:** Drizzle does not create the extension, so `db migrate` runs
`CREATE EXTENSION IF NOT EXISTS vector` *before* applying migrations (`src/db/migrate.ts`).

> **🟢 Plain-language primer**
>
> - **Table / row / column** — a database table is like a spreadsheet. Each **row** is one record (here,
>   one npm package); each **column** is one field about it (its name, its download count, etc.).
> - **Denormalized** — normally you'd split related data across several tables and stitch them together
>   on read (a "JOIN"). lurq instead keeps *everything about a package in one wide row*, so a lookup is
>   a single fast read with no stitching. The trade-off (some duplicated data) is worth it because lurq
>   reads far more often than it writes. ("No joins on the hot path" = the frequently-run queries never
>   pay the cost of combining tables.)
> - **Data types:** `int`/`integer` = whole number, `bigint` = very large whole number, `real` =
>   decimal number, `boolean` = true/false, `text` = a string of characters, **`jsonb`** = a whole
>   nested data structure stored in one column (Postgres's binary JSON), **`vector(1536)`** = a list of
>   1,536 numbers representing meaning (see §9).
> - **Primary key (PK)** — the column that uniquely identifies a row (no two rows share it). **Unique**
>   means a column's values can't repeat.
> - **Index** — a behind-the-scenes lookup structure that makes searching a column fast, like the index
>   at the back of a book. The **HNSW** index is a specialized one for finding "nearest" vectors quickly.
> - **Extension** — an optional add-on that teaches Postgres a new trick; `pgvector` is the extension
>   that adds the `vector` type and similarity search.
> - **Migration** — a versioned script that sets up or changes the database structure. Running
>   migrations brings a fresh database to the exact shape the code expects.
> - **Audit trail** — a log of what happened (here, a record of each data-refresh run and any errors),
>   useful for debugging and trust.
> - **Seed / bootstrap list** — a starter set of data (230 hand-picked packages) loaded on day one so
>   the system isn't empty before real usage fills it in.

---

## 6. The ingestion pipeline

### 6.1 The shared HTTP layer (`src/core/http.ts`)

Every external call goes through one `httpRequest` wrapper that provides three things:

1. **Per-host rate limiting.** A `HostLimiter` per hostname enforces `maxConcurrent` + a
   `minIntervalMs` gap between request starts. Tuned per source (`HOST_CONFIG`): GitHub and the npm
   registry get 4 concurrent / 50ms; the **downloads API is serialized** (`maxConcurrent: 1`,
   250ms gap) because it rate-limits aggressively; Bundlephobia is gentled (2 / 200ms).
2. **Retry with backoff.** Retryable statuses (`429, 500, 502, 503, 504`) and network/timeout errors
   retry up to 3× with exponential backoff (`500 * 2^attempt`) plus small *deterministic* jitter
   (no `Math.random`, keeping behavior reproducible). `Retry-After` is honored when present.
3. **Two-tier caching.** An in-memory `Map` plus an on-disk cache (`~/.cache/lurq/http`, sha256-keyed
   files) with per-source TTLs from `constants.ts` (registry 6h, downloads 12h, github 12h,
   deps.dev 24h, Bundlephobia 7d). `ttlMs: 0` disables caching entirely — used for the `verify`
   liveness check. `sync --full` sets `bypassCacheRead` so it refetches everything but still refreshes
   the cache.

Timeouts use `AbortController`; the response body is read once and decoded as JSON or text.

### 6.2 Source clients (`src/ingestion/sources/`)

Each client normalizes one API into a nullable shape declared in `ingestion/types.ts`:

- **`npmRegistry.ts`** — base metadata from `registry.npmjs.org`: version, description, license,
  repository (parsed into `{owner, repo}` from any GitHub URL form via `parseGithubRepo`), publish
  times, deprecation, maintainer count, and the README. Also exports `npmPackageExists` — a live,
  **uncached** existence check (`ttlMs: 0`, `retries: 1`) that powers `verify`.
- **`npmDownloads.ts`** — weekly downloads + 90-day growth. Weekly downloads are fetched in **bulk**
  (npm's point API accepts up to 128 comma-separated packages per call), which dodges the harsh
  per-package rate limiting; scoped (`@scope/name`) packages aren't bulk-supported and fall back to
  single fetches. Growth is computed from the daily range API: mean of the most recent 30 days vs the
  prior 30, as a fractional change.
- **`github.ts`** — stars, open/closed issues, archived flag, last release, releases-in-last-12-months
  (the cadence signal). Only called when a `GITHUB_TOKEN` is present and a repo was resolved.
- **`depsDev.ts`** — OpenSSF Scorecard (0–10) keyed by `github.com/owner/repo`, plus advisories:
  the version endpoint lists advisory keys (capped at 10), each fetched and bucketed into a severity
  from its CVSS3 score (`≥9 critical, ≥7 high, ≥4 moderate, >0 low`).
- **`bundlephobia.ts`** — minified+gzipped bundle size (frontend-relevant only).
- **`githubReadme.ts`** — raw README fallback when npm's is empty (for summary generation).

### 6.3 Collecting signals (`src/ingestion/collect.ts`)

`collectSignals(name, category, deps)` gathers everything for one package with **fault isolation**:

1. Fetch the **registry first** (it provides the repo + version the other sources need).
2. Then run downloads, GitHub, deps.dev, and Bundlephobia **concurrently** (`Promise.all`).

Each source is wrapped in `attempt()`, which catches any error, records it to a per-package `errors[]`
array, logs at debug, and returns `null`. The result is a `RawPackageSignals` object where any field
may be null — ingestion never crashes on a single source outage (§17 resilience).

> **🟢 Plain-language primer**
>
> - **Ingestion** — the process of pulling raw data in from the outside world (npm, GitHub, etc.) and
>   storing lurq's cleaned-up version of it. Think "gathering the ingredients."
> - **API** — "application programming interface": a URL a program can request to get data back, in a
>   machine-readable form. lurq asks npm's and GitHub's APIs about each package. **JSON** is the common
>   text format that data comes back in.
> - **HTTP request** — the act of asking a server on the internet for something (the same mechanism
>   your browser uses to load a page). A "client" is the code that makes these requests.
> - **Rate limiting** — external APIs cap how many requests you may make per second and will block you
>   if you exceed it. lurq throttles itself (limits how many requests run at once and spaces them out)
>   to stay under those caps and be a polite "API citizen."
> - **Concurrency** — doing several things at the same time. Fetching from four APIs *concurrently*
>   (`Promise.all`) is much faster than one after another. ("Serialized" is the opposite: strictly one
>   at a time, used for the touchy downloads API.)
> - **Retry with backoff** — if a request fails for a temporary reason, try again — but wait longer
>   between each attempt ("exponential backoff") so you don't hammer a struggling server. **`Retry-After`**
>   is a hint some servers send telling you exactly how long to wait.
> - **Cache / TTL** — saving a copy of a fetched answer so you don't have to re-fetch it for a while.
>   **TTL** ("time to live") is how long that copy is trusted before it's considered stale. "Two-tier"
>   = a fast copy in memory plus a longer-lived copy on disk.
> - **Fault isolation** — designing so one part failing can't take down the whole. Each data source is
>   wrapped so that if it errors, lurq notes the error, treats that one signal as missing (`null`), and
>   carries on scoring the package with whatever else it got.
> - **`AbortController` / timeout** — a way to cancel a request that's taking too long, so a slow server
>   can't hang lurq forever.

---

## 7. The scoring model (`src/scoring/`)

This is the heart of lurq's objectivity claim. **All weights and thresholds live in one file**
(`weights.ts`) so the model is tunable in one place. All scoring functions are pure and take `now`.

### 7.1 The composite health score

```
health = 0.35·maintenance + 0.30·adoption + 0.25·reliability + 0.10·efficiency
```

When `efficiency` is `null` (backend packages, where bundle size is meaningless), its 0.10 weight is
**redistributed** proportionally across the other three — so a backend package isn't penalized for
lacking a frontend metric. Result is rounded to an integer 0–100.

### 7.2 Sub-scores

- **Maintenance** = weighted average of three components (only those available count):
  - *recency* (weight 0.5): full 100 if released within 30 days, decaying linearly to 0 at 730 days.
  - *cadence* (0.25): releases in the last 12 months, capped at 12 → 100.
  - *close ratio* (0.25): `closedIssues / (open+closed)`.
  - **Hard cap:** deprecated or archived packages are capped at 15 regardless.
- **Adoption**: log-scaled weekly downloads (`10/wk → 0`, `10M/wk → 100`), blended with log-scaled
  stars (stars get 0.2 weight when available), plus a download-growth bonus of ±20.
- **Reliability**: `scorecard × 10` (or a neutral 50 when no Scorecard exists), minus advisory
  penalties by severity (critical −40, high −20, moderate −8, low −3, info 0). Clamped to ≥0.
- **Efficiency** (frontend only): compares the package's gzipped bundle to its **category median**
  (median maps to 50; smaller → higher). Returns `null` for backend categories or missing data.

### 7.3 Confidence — deliberately independent of the score

`confidence` is an *evidence-trustworthiness* label, not a quality grade (a package can be healthy but
`unproven` if young). Thresholds (`weights.ts → CONFIDENCE`):
- **proven**: ≥100k weekly downloads, ≥12 months old, released within 6 months, no critical/high
  advisory, not deprecated/archived.
- **emerging**: ≥5k downloads *or* ≥50% growth, released within 9 months, not dead.
- **unproven**: everything else.

### 7.4 Why two passes

Efficiency needs the **category median bundle size**, which can't be known until all packages in a
category are collected. So scoring is split: pass 1 computes the per-package sub-scores
(maintenance/adoption/reliability/confidence); then medians are computed; pass 2 finalizes efficiency
and the composite. (See the pipeline below.)

> **🟢 Plain-language primer**
>
> - **The big idea:** lurq turns messy real-world facts (downloads, stars, last release date, security
>   grades) into a single **health score from 0–100**, plus four sub-scores so you can see *why*. It's
>   a recipe: measure a few things, convert each to a 0–100 scale, then take a weighted blend.
> - **Weights** — how much each ingredient counts. `0.35·maintenance` means maintenance is 35% of the
>   final score. The four weights add up to 1.0 (100%).
> - **Weighted average** — adding things up where some count more than others. If only some ingredients
>   are available, lurq averages over just those (and "redistributes" the missing one's weight to the
>   rest, so a backend package isn't punished for having no bundle-size metric).
> - **Log scale (`log10`)** — downloads range from tens to hundreds of millions, so raw numbers are
>   useless to compare. A logarithmic scale compresses that: it cares about *order of magnitude* (is
>   this 1,000/wk or 1,000,000/wk?) rather than exact counts. `10/wk → 0` and `10M/wk → 100`.
> - **Clamp** — force a number to stay inside a range. `clamp(x, 0, 100)` turns anything below 0 into 0
>   and anything above 100 into 100, so scores can't escape their bounds.
> - **Median** — the middle value when you sort a list. lurq compares a package's bundle size to the
>   *median* size in its category, so "is this heavy or light?" is judged against real peers.
> - **Linear decay** — a score that slides down a straight line as something ages (a release fresh
>   within 30 days scores 100; by 730 days it has slid to 0).
> - **Advisory** — a published security warning about a package. Each one subtracts points by how
>   severe it is (a "critical" costs far more than a "low").
> - **Confidence vs. score** — kept separate on purpose. The *score* says "how good"; *confidence*
>   (`proven`/`emerging`/`unproven`) says "how much evidence backs that up." A brand-new package can be
>   genuinely good (high score) yet `unproven` (not enough track record yet).
> - **Two-pass** — some calculations need information about *all* packages first (e.g. the category
>   median). So lurq makes one pass to compute everything per-package, pauses to compute the
>   cross-package medians, then makes a second pass to finish. Like grading on a curve: you can't curve
>   until every exam is in.

---

## 8. Summaries & usage guides (`src/ingestion/summarize.ts`)

lurq doesn't just rank — it **explains**, and it generates its own explanation grounded in the
package README/description (never fabricated, never dependent on Context7).

- **`SummaryProvider`** is a pluggable interface with two implementations:
  - **`OpenAISummaryProvider`** — calls the chat completions API (raw `fetch`, no SDK) with a strict
    system prompt: *"Use ONLY the provided README/description. Never invent capabilities or APIs."*
    Returns a JSON `UsageGuide` (`whatItIs`, `whenToUse`, `whenNotToUse`, `whereItFits`, `howToWireIn`).
    Summaries are cached 30 days to control cost.
  - **`FallbackSummaryProvider`** — no API key required. Uses the npm description (truncated to ~3
    sentences) plus a category-derived architectural role (`CATEGORY_ROLE` map). Fabricates nothing.
- Every guide carries a **`context7Hint`**: lurq tells you *what/when/where*; for the exact current
  API it points you to Context7 (`resolve-library-id → query-docs`). This is the deliberate
  complement-not-duplicate boundary with Context7.
- The OpenAI provider falls back to the fallback provider on any error — generation never breaks
  ingestion.

> **🟢 Plain-language primer**
>
> - **Usage guide / summary** — lurq doesn't just rank packages; for each one it writes a few plain
>   sentences: what it is, when to use it, where it fits. That text is generated once during ingestion
>   and stored.
> - **LLM** — "large language model," the kind of AI that writes text (e.g. OpenAI's GPT). lurq can
>   optionally use one to write nicer summaries.
> - **System prompt** — the standing instruction given to the LLM that sets its rules. Here it's
>   strict: *only use the provided README, never invent capabilities* — to prevent the AI from
>   hallucinating features. ("Grounded" = based strictly on real source text, not made up.)
> - **Fallback** — a simpler backup path used when the fancy one isn't available. With no AI key set,
>   lurq still produces a guide from the package's own npm description — it just won't be as polished.
>   The point: lurq works for free, and *fabricates nothing* either way.
> - **`context7Hint`** — lurq tells you *what/when/where* a package fits but points you to a different
>   tool (Context7) for the exact, current code syntax. It deliberately doesn't duplicate that job.

---

## 9. Embeddings & semantic recommendation (`src/search/`)

### 9.1 Embeddings (`embeddings.ts`)

`EmbeddingProvider` is pluggable with two implementations, both emitting **1536-dim unit vectors** so
the DB column and pgvector index never change:
- **`OpenAIEmbeddingProvider`** — `text-embedding-3-small`, batched 96 at a time, cached 30 days.
- **`LocalEmbeddingProvider`** — a **zero-credentials deterministic embedder**: an FNV-1a–hashed
  bag-of-words (plus bigrams at half weight) projected into 1536 dims and L2-normalized. Crude but
  real lexical overlap, so `recommend` and the test suite work with no API key at all.

The text embedded per package is a normalized blob: `"{name}. {category}. {summary|description}"`.

### 9.2 Recommendation (`recommend.ts`)

The flow:
1. Embed the natural-language `need`.
2. Infer a `category` from the need (keyword rules in `categoryInference.ts`), unless one was passed.
3. Run a **pgvector cosine search** (`1 - cosineDistance`) over a candidate pool (`max(limit×5, 25)`),
   filtered by category and any constraints (`license`, `maxBundleKb`, `minConfidence`).
4. **Broaden if starved:** if the category filter returns fewer than `limit`, re-run without the
   category filter and merge in the new names.
5. **Re-rank** by a blend: `score = 0.6·simNorm + 0.4·(health/100)`.

A deliberate design note in the code: cosine `[-1,1]` is mapped to `[0,1]` with a **fixed transform**,
*not* pool min-max normalization — because min-max over-amplifies the single closest match, letting one
noisy embedding outrank a much healthier package. Fixed normalization keeps health meaningful in the
blend.

Each candidate gets a ≤1-sentence `why` (e.g. `"proven, 12M weekly downloads, health 91"`).

> **🟢 Plain-language primer**
>
> - **Embedding** — a way to turn text into a list of numbers (a "vector") that captures its *meaning*,
>   so that two texts about similar things end up with similar number-lists. This is what lets lurq
>   match the *idea* "a form library for React" to packages even if they don't use those exact words.
> - **Vector** — just an ordered list of numbers (here, 1,536 of them). You can think of it as a point
>   in space; texts with similar meaning sit close together.
> - **Cosine similarity / distance** — a measure of how close two vectors point in the same direction,
>   i.e. how similar two meanings are. lurq's database (via pgvector) can find the packages whose
>   vectors are closest to your query's vector.
> - **Semantic search** — searching by *meaning* rather than by exact keyword match. The opposite of
>   "find rows where the text literally contains this word."
> - **Local deterministic embedder** — the free, no-AI-key fallback. It builds the number-list by
>   hashing the words (a "bag of words"). **Hashing** turns a word into a number reproducibly;
>   **FNV-1a** is the specific hashing recipe. It's cruder than a real AI embedder but needs no
>   credentials and always gives the same answer for the same input. **L2-normalize** rescales the
>   vector to a standard length so comparisons are fair.
> - **Re-rank** — after finding candidates by meaning-similarity, lurq re-sorts them by blending
>   similarity (60%) with the health score (40%), so the result is both *relevant* and *good* — not
>   just the closest text match. The note about "fixed transform vs. min-max" is a safeguard so one
>   oddly-close-but-low-quality match can't jump to the top.

---

## 10. The pipeline (`src/pipeline/`)

### 10.1 Bulk sync (`sync.ts`) — the `lurq sync` command

End-to-end ingestion for the whole seed list (or one package):

1. Open a DB handle sized to the configured concurrency; start a `sync_runs` audit row.
2. Resolve targets (seed list, or a single `--package`).
3. **Bulk-fetch weekly downloads up front** (one call per 128 packages) to avoid rate limits.
4. **Pass 1** (`pMap`, bounded concurrency): for each package, `collectSignals` → `toScoringInput` →
   build summary input → generate summary/guide → compute maintenance/adoption/reliability/confidence.
   Per-package failures are recorded and the package is dropped (returns `null`), not fatal.
5. Compute **category medians** of bundle size across the successfully-collected frontend packages.
6. **Embed** all packages' text blobs in one batched call.
7. **Pass 2:** compute efficiency (needs the median) and the composite health score, then
   `upsertPackage` each row.
8. Finish the audit row with status `success` (no errors), `partial` (some source errors), or
   `failed` (nothing updated). `sync` is idempotent and cron-able.

### 10.2 On-demand single-package path (`single.ts`) — coverage that grows itself

This is the "**not tracked**" behavior (§12.5) and arguably the cleverest growth mechanism:

- `getOrFetchPackage(db, name)`:
  - If the package is already tracked → return it (`wasTracked: true`).
  - Else check npm existence. If it exists → `syncOnePackage` fetches, scores, embeds, stores, and
    returns it. If not → `row: null`.
- `syncOnePackage` mirrors the bulk pipeline for one package, but computes the category median via a
  SQL `percentile_cont(0.5)` over already-tracked packages in that category.

So any time an agent evaluates, compares, or verifies a package lurq has never seen, lurq ingests it
on the spot — **the seed list bootstraps coverage, and real usage organically expands it.**

> **🟢 Plain-language primer**
>
> - **Pipeline** — a sequence of steps where each feeds the next: gather data → score → summarize →
>   embed → save. lurq has two: a **bulk** one (refresh the whole list) and a **single-package** one
>   (handle one package on demand).
> - **`sync`** — the command that refreshes lurq's data by re-running the pipeline over all seed
>   packages. It's meant to run on a schedule (e.g. nightly) to keep scores fresh.
> - **Bounded concurrency (`pMap`)** — process many packages in parallel, but only N at a time, so you
>   go fast without overwhelming the APIs or the machine.
> - **Upsert** — "update or insert": if the package row already exists, refresh it; if not, create it.
>   One operation either way.
> - **Idempotent** — running it again produces the same result, not duplicates or damage. So a `sync`
>   that gets interrupted can simply be re-run safely.
> - **On-demand / "not tracked" behavior** — if an agent asks about a package lurq has never indexed,
>   lurq fetches and scores it *right then*, stores it, and answers — so the catalog grows itself
>   through real usage instead of needing every package pre-loaded.
> - **`percentile_cont(0.5)`** — a SQL function that computes the median directly inside the database
>   (the 50th percentile = the middle value), used to find a category's median bundle size on the fly.

---

## 11. The MCP surface (`src/mcp/`)

`server.ts` registers **5 tools** on an `McpServer` over stdio, with zod input schemas. Outputs are
compact JSON text (response-size discipline: target < 1,500 tokens, summaries truncated to 3
sentences, advisories capped at top 5 by severity, always a `dataAsOf`).

`handlers.ts` holds the logic as **pure functions over a `Database`** (the CLI reuses them directly):

| Tool | Behavior |
|---|---|
| **`recommend`** | Embed need → search → re-rank → ≤5 candidates with `why`, confidence, `dataAsOf`. |
| **`evaluate`** | Full evidence read for one package (via `getOrFetchPackage`, so it ingests on demand). Returns score breakdown, signals, capped advisories, summary, usage guide; flags `stale: true` if `dataAsOf` is older than 7 days. |
| **`compare`** | Fetches 2–5 packages (on-demand if needed), ranks by health, lists any `missing`. |
| **`verify`** | The anti-slopsquat guard. Live npm existence check (uncached), then risk flags: `not-found-on-registry`, `zero-downloads`/`low-downloads`, `published-within-7-days`, `single-maintainer`, `has-known-advisory`, `deprecated`, `archived`. |
| **`diagram`** | Optional reference-architecture Mermaid diagram (covered next). |

> **🟢 Plain-language primer**
>
> - **Tool (in MCP terms)** — one named capability the agent can invoke, like a function on a menu.
>   lurq offers five: `recommend`, `evaluate`, `compare`, `verify`, `diagram`.
> - **Schema (zod)** — the declared shape of a tool's input ("`recommend` takes a text `need` and an
>   optional `category`"). The server checks the agent's request against this before running, rejecting
>   malformed calls early with a clear error.
> - **Handler** — the function that actually does the work for a tool. Keeping handlers as plain
>   functions "over a Database" means the CLI can reuse the exact same logic the agent uses — one
>   implementation, two front doors.
> - **"Response-size discipline"** — agents pay (in tokens/cost) for every word a tool returns, so lurq
>   deliberately keeps answers short: trimmed summaries, only the top few advisories, no raw data dumps.
> - **`dataAsOf` / `stale`** — every answer is stamped with when its data was gathered, and flagged
>   `stale` if that was over a week ago, so the agent knows how much to trust it.
> - **Anti-slopsquat guard (`verify`)** — checks a package name against the *live* npm registry (no
>   cache) and raises red flags (brand-new, single maintainer, zero downloads, known security advisory)
>   so the agent doesn't install a typo-squatted or malicious look-alike.

---

## 12. The diagram tool (`src/mcp/diagram.ts`) — current narrow state

The most-recently-revised tool, deliberately scoped to *not* be an "architecture oracle":

- **Input is stack-only** (`{ stack?: string[] }`) — package names the caller has *already chosen*.
  It does not infer an architecture from a freeform description (that was removed as the
  oracle-adjacent behavior).
- It resolves each package's category (from the DB, else best-effort `inferCategory`, else `null`),
  maps categories to architectural layers (`Presentation / Client Logic / Backend / Data / Tooling`),
  and emits a Mermaid `flowchart TD` connecting `User → … → Database`.
- **Honest failure:** a package that can't be classified goes into an explicit **`Unclassified`**
  bucket rendered *outside* the flow, and the `note` names which packages couldn't be placed —
  "partial, not authoritative." It never fakes a default layer.
- **Known limitation, documented:** the taxonomy has a single `framework` category, so frontend vs
  backend frameworks can't be told apart from category alone. A hand-maintained `BACKEND_FRAMEWORKS`
  set re-routes common backend frameworks to the Backend layer; an unlisted one will be drawn in
  Presentation. This is a band-aid; the real fix (a distinct backend-framework category or a target
  flag) is deferred to post-v1 (tracked in master spec §12.3.5 and §20.5).
- Empty input returns a clear guidance note rather than a schema error.

> **🟢 Plain-language primer**
>
> - **Mermaid** — a text format for describing diagrams; tools (and GitHub) render the text into an
>   actual picture. `flowchart TD` means "a flowchart, drawn top-down." So `diagram` returns *text*
>   that draws a boxes-and-arrows picture of a chosen stack.
> - **Architectural layer** — a tier of an app: Presentation (what the user sees), Client Logic, Backend
>   (server), Data (database), Tooling (build/test). `diagram` sorts the packages you name into these.
> - **"Architecture oracle" (the non-goal)** — a tool that *designs* your whole app for you. lurq
>   refuses to do this; it only labels a stack *you* already chose. That's why it diagrams a given list
>   rather than inventing one from a vague description.
> - **Unclassified bucket** — if lurq can't confidently place a package, it puts it in a visible
>   "Unclassified" box and says so, instead of guessing a layer and pretending it's sure. Honest "I
>   don't know" beats a confident wrong answer.

---

## 13. The CLI (`src/cli/`)

`bin/lurq.ts` loads env and hands off to `buildProgram()` (commander). Commands:

```
lurq serve                         # start the MCP server over stdio
lurq sync [--full] [--package <n>] # run ingestion
lurq recommend "<need>" [--category <c>] [--min-confidence <c>]
lurq evaluate <package>
lurq compare <pkgA> <pkgB> [...]
lurq verify <package>
lurq install-skill [--agent claude-code|cursor|copilot|windsurf|codex|all]
lurq db migrate                    # pgvector ext + migrations + seed load
lurq db reset --yes                # destructive: drop & recreate schema
```

`commands.ts` reuses the **same MCP handlers** against a DB connection and renders compact tables /
detail views (`format.ts`). **`--json` on every command** produces machine output. `db reset` refuses
to run without `--yes`. Command actions lazy-`import()` their implementations so the CLI starts fast.

> **🟢 Plain-language primer**
>
> - **`commander`** — a library for building command-line tools: it parses what the user typed into
>   commands (`recommend`), arguments (`"a form library"`), and options.
> - **Flags / options** — the extra switches after a command. `--json` changes the output format;
>   `--category react` narrows a search; `--yes` confirms a destructive action. A flag in `[brackets]`
>   is optional; `<angle brackets>` mark a required argument.
> - **`--json`** — by default the CLI prints pretty tables for humans; adding `--json` prints raw
>   structured data instead, for feeding into other programs or scripts.
> - **Destructive command** — one that deletes data (`db reset` wipes the database). lurq makes you
>   pass `--yes` so you can't trigger it by accident.
> - **Lazy `import()`** — only load a chunk of code at the moment it's actually needed, instead of all
>   of it up front. This makes the tool start up noticeably faster.

---

## 14. The agent skill installer (`src/cli/installSkill.ts`)

`lurq install-skill` registers lurq as an MCP server in supported assistants by **merging** a single
`lurq` entry into each agent's config — never overwriting unrelated config:

- Supports **claude-code, cursor, windsurf, copilot (VS Code), codex**; `--agent all` does each
  *detected* agent.
- Writes the right shape per agent: JSON `mcpServers` (claude-code/cursor/windsurf), JSON `servers`
  (VS Code/Copilot), or a TOML `[mcp_servers.lurq]` block (Codex). The entry is
  `npx -y lurq serve` plus any env vars present in the current environment.
- Copies `templates/skill-instructions.md` to `~/.lurq/` — the "**when to call lurq**" guide that
  tells the agent to call `recommend` before picking a dependency and `verify` before installing one.
- Prints exactly what it did and a manual fallback, and warns if `DATABASE_URL` isn't set, so a stale
  config path is obvious rather than silent.

> **🟢 Plain-language primer**
>
> - **The installer's job** — wire lurq into whatever AI assistant you use, so the assistant knows lurq
>   exists and when to call it. It edits that assistant's config file for you.
> - **Config file** — a settings file an app reads on startup. Each assistant has its own, in its own
>   format: **JSON** (curly-brace structured data) for most, **TOML** (a different settings format) for
>   Codex.
> - **Merging, not overwriting** — lurq adds *only its own entry* and leaves your existing settings
>   untouched. The opposite (overwriting) would clobber your other tools' configuration — a cardinal
>   sin the installer carefully avoids.
> - **"Detected" agent** — `--agent all` only touches assistants it can actually find installed on your
>   machine, by checking whether their folders exist.
> - **`npx -y lurq serve`** — the command the assistant will run to start lurq. `npx` runs an npm tool
>   without a separate install step; `serve` launches the MCP server.

---

## 15. Configuration (`src/core/config.ts`)

Env is validated with zod. Most vars are optional so the CLI runs partially without full setup;
commands that need a var call `requireConfig([...])` to fail fast with a clear message.

| Var | Required | Purpose |
|---|---|---|
| `DATABASE_URL` | yes (for DB commands) | Postgres + pgvector connection |
| `GITHUB_TOKEN` | recommended | GitHub signals (stars, cadence, issues, archived) |
| `EMBEDDING_PROVIDER` / `EMBEDDING_API_KEY` / `EMBEDDING_MODEL` | no | OpenAI embeddings; falls back to local embedder |
| `SUMMARY_PROVIDER` / `SUMMARY_API_KEY` / `SUMMARY_MODEL` | no | LLM usage guides; falls back to npm description |
| `LURQ_SYNC_CONCURRENCY` | no (default 5) | sync parallelism |
| `LOG_LEVEL` | no (default info) | logging verbosity |

The graceful-degradation theme is end-to-end: **only `DATABASE_URL` is strictly required**; without
GitHub/OpenAI keys, lurq still works, just with fewer/cruder signals.

> **🟢 Plain-language primer**
>
> - **Environment variable ("env var")** — a setting passed to a program from outside its code, so
>   secrets and machine-specific values (database location, API keys) aren't hard-coded. They live in a
>   `.env` file or the shell.
> - **API key / token** — a secret password that proves you're allowed to use a paid or rate-limited
>   service (OpenAI, GitHub). lurq's optional features use these; without them it falls back to free
>   paths.
> - **`DATABASE_URL`** — the one required setting: where lurq's Postgres database lives (host, user,
>   password, database name) in a single string.
> - **"Fail fast"** — if a command genuinely needs a setting that's missing, lurq stops immediately with
>   a clear message rather than failing confusingly halfway through.
> - **Graceful degradation** — the system keeps working with reduced quality when optional pieces are
>   absent, instead of refusing to run at all.

---

## 16. Resilience & operational design

- **Fault isolation:** every source failure is recorded and degraded to `null`; a package with a dead
  source still scores on the rest.
- **Audit trail:** `sync_runs` records seen/updated counts, per-source errors, and a
  `success/partial/failed` status.
- **Idempotency:** `upsertPackage` does `onConflictDoUpdate` keyed by name, refreshing every mutable
  field and bumping `updatedAt` while preserving `createdAt`. `sync` and seed loading are safe to
  re-run.
- **Staleness:** reads flag `stale: true` when `dataAsOf` is older than 7 days, so agents know when
  data is aging.
- **Rate-limit friendliness:** per-host limiters + bulk downloads + persistent caching keep lurq a
  polite API citizen and make a full sync feasible (~2 minutes on cached data).
- **Determinism:** scoring takes explicit `now`; HTTP backoff jitter is deterministic — so tests are
  reproducible.

---

## 17. Testing (`tests/`)

**81 tests across 12 files**, no live network or DB required (HTTP is faked via injected `fetch`;
pure functions dominate):

- `scoring.test.ts` (17) — the scoring math (the largest suite, befitting the core asset).
- `ingestion/parsers.test.ts` (15) — source-response parsing (registry/downloads/deps.dev shapes).
- `diagram.test.ts` (9) — layering, the Unclassified bucket, empty-input note, classification
  annotation.
- `core.test.ts` (7), `search.test.ts` (6), `format.test.ts` (6), `seed.test.ts` (5),
  `summarize.test.ts` (5), `mcp.test.ts` (4), `installSkill.test.ts` (4), `ingestion/http.test.ts`
  (4, incl. retry-on-5xx), `ingestion/collect.test.ts` (1).

`npm run typecheck` (tsc `--noEmit`) and `npm test` both pass clean.

> **🟢 Plain-language primer**
>
> - **Test** — a small automated script that runs a piece of the code with known inputs and checks the
>   output is correct. If someone later breaks that piece, a test "fails" and warns them.
> - **Test suite / file** — tests grouped by what they cover (`scoring.test.ts` tests the scoring math).
>   "81 tests across 12 files" = 81 individual checks.
> - **Faked `fetch` / no live network** — tests feed in *pretend* API responses instead of calling the
>   real internet, so they run fast, work offline, and give the same result every time.
> - **`typecheck`** — runs the TypeScript compiler in "check only" mode (`--noEmit` = don't produce
>   output files, just verify the types line up). Catches whole classes of mistakes before the code
>   ever runs.
> - **"Pass clean"** — every test passed and the type-check found no problems.

---

## 18. Build order (milestones, all complete)

Per the master spec §18, implemented in sequence — each milestone ending with passing tests:

| M | Deliverable |
|---|---|
| M1 | Schema, migrations, pgvector, seed loading |
| M2 | HTTP layer + source clients |
| M3 | Collect + scoring + two-pass pipeline |
| M4 | Embeddings + semantic recommend |
| M5 | MCP server (recommend / evaluate / compare / verify) |
| M6 | CLI query commands with tables + `--json` |
| M7 | Agent skill installer |
| M8 | Optional `diagram` tool + docs + acceptance (later narrowed to stack-only) |

---

## 19. Current status & what's explicitly deferred

**Working today:** the full v1 — migrate+seed, bulk sync from public APIs, the 5 MCP tools, the CLI,
the installer, on-demand coverage growth, and graceful degradation without optional keys.

**Deferred (non-goals / post-v1 roadmap):**
- ❌ Full security/vuln scanning (Snyk/Socket's job) — `verify` stays a lightweight wedge.
- ❌ Full API documentation serving (Context7's job) — integrated as a hint, not rebuilt.
- ❌ Whole-architecture recommendation — the `diagram` tool stays a labeled starting point.
- ⏳ **Diagram instrumentation + taxonomy fix** (§20.5): log the unclassified rate alongside the
  install-data instrumentation, and resolve the front/back `framework` ambiguity with a real
  taxonomy change. Not instrumented in v1.
- ⏳ The strategic roadmap layer (wireability score, deprecation→replacement, outcome-data flywheel,
  policy tier) — the moat-deepening features above the v1 build.

**The honest read on defensibility (from the spec):** at v1 the underlying data is public and
copyable; lurq wins on *depth in one ecosystem, freshness, objective scoring, and ergonomics inside
the agent loop* — and on earning the adoption that later makes the proprietary outcome-data flywheel
possible.

---

*Generated as a walkthrough of the codebase as of this commit. For the authoritative build
contract see `lurq-v1-master-spec.md`; for strategy see `lurq-feature-roadmap.md`.*
</content>
</invoke>
