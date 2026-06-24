# lurq

> dynamic index of sdk's, frameworks, and libraries exposed as an mcp server. cli-based installable agent skill, compatible with agentic code assistants and ides, including vscode, cursor, windsurf, claude code, and codex. lurq focuses specifically on objective package recommendations from open-source dependencies. 

lurq is a **companion to your coding agent**: it recommends and explains packages, and your agent writes the code. prioritized for token cost, speed, and retrieval quality, and diagrams a stack you've chosen when prompted. notice: lurq contains a growing, comprehensive database of packages, allowing newer dependencies to be exposed to the agent outside of the training data of the underlying model. 

**v1 scope:** the javaScript/typeScript web stack (npm) only.

---

## quick start — connect your agent

lurq is a **hosted service**: you don't run a database or a sync. get an API key,
then run the guided installer:

```bash
npx lurqrun install
```

it prompts for your key, validates it, detects your installed assistants
(Claude Code, Cursor, Windsurf, VS Code/Copilot, Codex), and writes a keyed
remote MCP entry —
`{ "type": "http", "url": "https://api.lurq.run/mcp", "headers": { "Authorization": "Bearer …" } }`.
**no database credentials ever touch your machine.** restart your agent afterward.

non-interactive / scriptable:

```bash
npx lurqrun install-skill --agent claude-code --api-key <key>   # or --agent all
```

## what your agent gets (mcp tools)

once installed, the agent can call these tools over MCP. every response is
compact and carries a `dataAsOf` timestamp.

- **`recommend`** — best current packages for a described need (≤5, scored, with confidence)
- **`evaluate`** — full evidence read for one package (scores, advisories, usage guide)
- **`compare`** — 2–5 packages ranked by health
- **`verify`** — is a package real, healthy, and not risky? (anti-hallucination guard)
- **`diagram`** — a reference-architecture mermaid diagram for a stack (optional)

---

## self-hosting / operating lurq

everything below runs **against your own lurq Postgres index** and needs
`DATABASE_URL`. it's for operators running the hosted service and for
self-hosters — not for end users (who only run `install` above).

### configuration

see [`.env.example`](./.env.example). only `DATABASE_URL` is required to run;
everything else degrades gracefully.

| var | required | purpose |
|---|---|---|
| `DATABASE_URL` | yes | postgres connection (pgvector-enabled) |
| `GITHUB_TOKEN` | recommended | github signals (stars, cadence, issues, archived) |
| `EMBEDDING_PROVIDER` / `EMBEDDING_API_KEY` | no | openai embeddings; falls back to a local embedder |
| `SUMMARY_PROVIDER` / `SUMMARY_API_KEY` | no | llm usage guides; falls back to the npm description |
| `PORT` | no (default 8080) | port for `serve-http` (Railway injects it) |
| `LURQ_RATE_LIMIT_MAX` / `LURQ_IP_RATE_LIMIT_MAX` / `LURQ_RATE_LIMIT_WINDOW_MS` | no | per-key / per-IP rate limits for `serve-http` |

### set up the index

```bash
lurqrun db migrate     # create schema (pgvector) + load the curated seed list
lurqrun sync           # compute scores from public APIs (~2 min)
```

`sync` is idempotent and tolerant of single-source outages. run it on a schedule
(daily) to keep the index fresh.

### serve

```bash
lurqrun serve-http     # hosted: HTTP MCP server + API-key auth (helmet, rate limits)
lurqrun serve          # self-host: stdio MCP server against your own DB
```

`serve-http` fronts the central DB; `DATABASE_URL` lives only on the service host.
self-hosters can wire their own agent to a local stdio server with
`install-skill --local`. deployment: see [`DEPLOY.md`](./DEPLOY.md).

### API keys (operator)

```bash
lurqrun keys create --label "acme"     # issue a key (shown once; stored hashed)
lurqrun keys list                      # prefix, tier, last-used, status
lurqrun keys revoke lurq_live_ab12cd   # revoke by prefix or id
```

### query / inspect from the CLI

the same engine, usable standalone (talks to your DB directly):

```bash
lurqrun recommend "a form library for react"
lurqrun recommend "debounce a function"
lurqrun evaluate zod
lurqrun compare drizzle-orm prisma typeorm
lurqrun verify lodahs
```

add `--json` to any command for machine output; `--category` and `--min-confidence`
filter `recommend`.

### scoring controls

```bash
lurqrun weights                              # show/explain the weight model (health, quality, λ)
lurqrun edit-weights --set composite.lambda=0.5   # override weights (or --reset)
lurqrun rescore                              # re-derive scores from cached breakdowns (no re-ingest)
lurqrun discover                             # operator: proactively crawl + gate new candidates
```

### development

```bash
npm install
npm run dev -- <command>   # run the CLI from source (tsx)
npm test
npm run typecheck
npm run lint
```

## how it works

```
public APIs (npm, github, deps.dev, bundlephobia)
  → ingestion → scoring (health + quality + confidence) → summaries/usage guides → embeddings
  → postgres + pgvector  (hybrid lexical + semantic search)
  → { stdio MCP server, HTTP MCP service (API keys), CLI }
```

scores are computed from public signals — never hand-written. confidence labels
(`proven` / `emerging` / `promising` / `unproven`) reflect the strength of the
discovered evidence. end users reach the index through the **hosted HTTP service**
with an API key; `DATABASE_URL` never leaves the operator's infrastructure.

## outreach 

for any inquiries, partnerships, or proposals, contact jaden ryu at jadenryu@gmail.com. 

## license

Apache License 2.0 
