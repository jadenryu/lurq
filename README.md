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
npx lurq --help
```

## development

```bash
npm run dev -- <command>   
npm test                    
npm run typecheck         
npm run lint               
```

## configuration

see [`.env.example`](./.env.example). only `DATABASE_URL` is strictly required;
gitHub/openAI keys enrich the data but lurq degrades gracefully without them.

| var | required | purpose |
|---|---|---|
| `DATABASE_URL` | yes | postgres connection (pgvector-enabled) |
| `GITHUB_TOKEN` | recommended | github signals (stars, cadence, issues, archived) |
| `EMBEDDING_PROVIDER` / `EMBEDDING_API_KEY` | no | openai embeddings; falls back to a local embedder |
| `SUMMARY_PROVIDER` / `SUMMARY_API_KEY` | no | llm usage guides; falls back to the npm description |

## setup the index

```bash
npx lurq db migrate     # create schema (pgvector) + load the curated seed list
npx lurq sync           # scores from public APIs (~2 min)
```

`sync` is idempotent and tolerant of single-source outages. run it on a schedule
(default cadence: daily) to keep the index fresh.

## cli usage

```bash
npx lurq recommend "a form library for react"    
npx lurq recommend "debounce a function"         
npx lurq evaluate zod                            
npx lurq compare drizzle-orm prisma typeorm      
npx lurq verify lodahs                            
```

add `--json` to any command for machine output; `--category` and `--min-confidence`
filter `recommend`.

## mcp tools

`npx lurq serve` starts the MCP server (stdio). it exposes:

- **`recommend`** — best current packages for a described need (≤5, scored, with confidence)
- **`evaluate`** — full evidence read for one package (scores, advisories, usage guide)
- **`compare`** — 2–5 packages ranked by health
- **`verify`** — is a package real, healthy, and not risky? (anti-hallucination guard)
- **`diagram`** — a reference-architecture mermaid diagram for a stack (optional)

every response is compact and carries a `dataAsOf` timestamp.

## install into your agent

```bash
npx lurq install-skill --agent claude-code   # or cursor | windsurf | copilot | codex | all
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

scores are computed from real public signals — never hand-written. confidence
labels (`proven` / `emerging` / `unproven`) reflect the strength of the evidence,
not the score.

## outreach 

for any inquiries, partnerships, or proposals, contact jaden ryu at jadenryu@gmail.com. 

## license

Apache License 2.0 
