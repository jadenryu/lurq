# lurq

> dynamic index of sdk's, frameworks, and libraries exposed as an mcp server. cli-based installable agent skill, compatible with agentic code assistants and ides, including vscode, cursor, windsurf, claude code, and codex. lurq focuses specifically on objective package recommendations from open-source dependencies. 

lurq is a **companion to your coding agent**: it recommends and explains packages, and your agent writes the code. prioritized for token cost, speed, and retrieval quality, and diagrams a stack you've chosen when prompted. notice: lurq contains a growing, comprehensive database of packages, allowing newer dependencies to be exposed to the agent outside of the training data of the underlying model. 

**v1 scope:** the javaScript/typeScript web stack (npm) only.

---

## quick start (dev)

```bash
npm install
cp .env.example .env       
docker compose up -d       
npm run build
npx lurqrun --help
```

## development

```bash
npm run dev -- <command>   
npm test                    
npm run typecheck         
npm run lint               
```

## configuration

see [`.env.example`](./.env.example). only `DATABASE_URL` is required;
gitHub/openAI keys allow full access to lurq commands but are not strictly necessary.

| var | required | purpose |
|---|---|---|
| `DATABASE_URL` | yes | postgres connection (pgvector-enabled) |
| `GITHUB_TOKEN` | recommended | github signals (stars, cadence, issues, archived) |
| `EMBEDDING_PROVIDER` / `EMBEDDING_API_KEY` | no | openai embeddings; falls back to a local embedder |
| `SUMMARY_PROVIDER` / `SUMMARY_API_KEY` | no | llm usage guides; falls back to the npm description |

## setup the index

```bash
npx lurqrun db migrate     # create schema (pgvector) + load the curated seed list
npx lurqrun sync           # scores from public APIs (~2 min)
```

`sync` is idempotent and tolerant of single-source outages. run it on a schedule
(default frequency: daily) to keep the index fresh.

## cli usage

```bash
npx lurqrun recommend "a form library for react"    
npx lurqrun recommend "debounce a function"         
npx lurqrun evaluate zod                            
npx lurqrun compare drizzle-orm prisma typeorm      
npx lurqrun verify lodahs                            
```

add `--json` to any command for machine output; `--category` and `--min-confidence`
filter `recommend`.

## mcp tools

`npx lurqrun serve` starts the MCP server (stdio). it exposes:

- **`recommend`** — best current packages for a described need (≤5, scored, with confidence)
- **`evaluate`** — full evidence read for one package (scores, advisories, usage guide)
- **`compare`** — 2–5 packages ranked by health
- **`verify`** — is a package real, healthy, and not risky? (anti-hallucination guard)
- **`diagram`** — a reference-architecture mermaid diagram for a stack (optional)

every response is compact and carries a `dataAsOf` timestamp.

## install into your agent

```bash
npx lurqrun install-skill --agent claude-code   # or cursor | windsurf | copilot | codex | all
```

merges a `lurq` MCP server entry into the agent's config (never overwriting other
config) and drops a short instructions file telling the agent when to call lurq.
restart the agent afterward.

## how it works

```
public APIs (npm, github, deps.dev, bundlephobia)
  → ingestion → scoring (+ confidence) → summaries/usage guides → embeddings
  → postgres + pgvector
  → { mcp server, cli }
```

scores are computed from public signals — never hand-written. confidence
labels (`proven` / `emerging` / `unproven`) reflect the strength of discovered evidence

## outreach 

for any inquiries, partnerships, or proposals, contact jaden ryu at jadenryu@gmail.com. 

## license

Apache License 2.0 
