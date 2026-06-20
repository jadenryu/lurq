# lurq

> dynamic index of sdk's, frameworks, and libraries exposed as an mcp server. cli-based installable agent skill, compatible with agentic code assistants and ides, including vscode, cursor, windsurf, claude code, and codex. lurq focuses specifically on objective package recommendations from open-source dependencies. 

lurq is a **companion to your coding agent**: it recommends and explains packages, and your agent writes the code. prioritized for token cost, speed, and retrieval quality, and diagrams architecture implementations when prompted. notice: lurq contains a growing, comprehensive database of packages, allowing newer dependencies to be exposed to the agent outside of the training data of the underlying model. 

**v1 scope:** the javaScript/typeScript web stack (npm) only.

---

## quick start (dev)

```bash
npm install
cp .env.example .env        # fill in DATABASE_URL (and optionally tokens/keys)
docker compose up -d        # local postgres + pgvector
npm run build
npx lurq --help
```

## development

```bash
npm run dev -- <command>    # run the cli from source (tsx)
npm test                    # vitest
npm run typecheck           # tsc --noEmit
npm run lint                # eslint
```

## configuration

see [`.env.example`](./.env.example). only `DATABASE_URL` is strictly required;
gitHub/openAI keys enrich the data but lurq degrades gracefully without them.


## outreach 

for any inquiries, partnerships, or proposals, contact jaden ryu at jadenryu@gmail.com. 

## license

Apache License 2.0 
