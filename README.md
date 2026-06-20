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

## what your agent gets (mcp tools)

once installed, the agent can call these tools over MCP. every response is
compact and carries a `dataAsOf` timestamp.

- **`recommend`** — best current packages for a described need (≤5, scored, with confidence)
- **`evaluate`** — full evidence read for one package (scores, advisories, usage guide)
- **`compare`** — 2–5 packages ranked by health
- **`verify`** — is a package real, healthy, and not risky? (anti-hallucination guard)
- **`diagram`** — a reference-architecture mermaid diagram for a stack (optional)

## outreach 

for any inquiries, partnerships, or proposals, contact jaden ryu at jadenryu@gmail.com. 

## license

Apache License 2.0 
