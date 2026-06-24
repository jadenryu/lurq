# lurq

> dynamic index of sdk's, frameworks, and libraries exposed as an mcp server. cli-based installable agent skill, compatible with agentic code assistants and ides, including vscode, cursor, windsurf, claude code, and codex. lurq focuses specifically on objective package recommendations from open-source dependencies. 

lurq is a **companion to your coding agent**: it recommends and explains packages, and your agent writes the code. prioritized for token cost, speed, and retrieval quality, and diagrams a stack you've chosen when prompted. notice: lurq contains a growing, comprehensive database of packages, allowing newer dependencies to be exposed to the agent outside of the training data of the underlying model. 

**v1 scope:** the javaScript/typeScript web stack (npm) only.

---

## quick start (dev)

```bash
npm install
npx lurqrun install
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

lurq is a **hosted service** — you don't run a database. Get an API key, then:

```bash
npx lurqrun install            # guided: paste your key, pick your assistants
```

the wizard validates the key, detects your installed assistants (Claude Code,
Cursor, Windsurf, VS Code/Copilot, Codex), and writes a keyed remote MCP entry —
`{ "type": "http", "url": "https://api.lurq.run/mcp", "headers": { "Authorization": "Bearer …" } }`.
**no database credentials ever touch your machine.** restart the agent afterward.

non-interactive / scriptable:

```bash
npx lurqrun install-skill --agent claude-code --api-key <key>   # or --agent all
```

**self-hosting?** run your own stdio server against your own DB with
`install-skill --local` (writes a local `npx lurqrun serve` entry using your
`DATABASE_URL`).

### running the service (operator)

```bash
lurq serve-http                       # HTTP MCP server with API-key auth (uses $PORT)
lurq keys create --label "acme"       # issue a key (shown once; stored hashed)
lurq keys list                        # prefix, tier, last-used, status
lurq keys revoke lurq_live_ab12cd     # revoke by prefix or id
```

`serve-http` fronts the central DB with helmet, per-key + per-IP rate limiting,
and Bearer auth. `DATABASE_URL` lives only on the service host. Deployment:
see [`docs/lurq-hosted-deployment.md`](./docs/lurq-hosted-deployment.md).

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
