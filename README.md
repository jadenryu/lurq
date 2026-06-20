# lurq

> dynamic index of sdk's, frameworks, and libraries exposed as an mcp server. cli-based installable agent skill, compatible with agentic code assistants and ides, including vscode, cursor, windsurf, claude code, and codex. focused specifically on objective dependency recommendations. 

lurq is a **companion to your coding agent**: it recommends and explains packages, and your agent writes the code.

**v1 scope:** the JavaScript/TypeScript web stack (npm) only.

---

## Status

🚧 In active development. Build progress by milestone:

- [x] **M0** — Scaffold (TS, build, tests, CLI surface, config)
- [x] **M1** — Database (Postgres + pgvector, schema, migrations, 230-package seed list)
- [ ] **M2** — Ingestion clients (npm, GitHub, deps.dev, Bundlephobia)
- [ ] **M3** — Sync pipeline + scoring + confidence + summaries/usage guides
- [ ] **M4** — Embeddings + semantic search
- [ ] **M5** — MCP server (`recommend`, `evaluate`, `compare`, `verify`)
- [ ] **M6** — CLI commands
- [ ] **M7** — Skill installer
- [ ] **M8** — Optional `diagram` tool + polish

## Quick start (dev)

```bash
npm install
cp .env.example .env        # fill in DATABASE_URL (and optionally tokens/keys)
docker compose up -d        # local Postgres + pgvector
npm run build
npx lurq --help
```

## Development

```bash
npm run dev -- <command>    # run the CLI from source (tsx)
npm test                    # vitest
npm run typecheck           # tsc --noEmit
npm run lint                # eslint
```

## Configuration

See [`.env.example`](./.env.example). Only `DATABASE_URL` is strictly required;
GitHub/OpenAI keys enrich the data but lurq degrades gracefully without them.


## Outreach 

For any inquiries, partnerships, or proposals, contact Jaden Ryu at jadenryu@gmail.com. 

## License

Apache License 2.0 
