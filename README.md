<div align="center">

# lurq

**The verification layer for AI coding agents to ship unbreakable code.**

A live index of npm scored from public signals and co-installation through a sandbox. Use lurq
through an MCP server, CLI, HTTP API, or an installable agent skill.

[![npm version](https://img.shields.io/npm/v/lurqrun?color=%230b7285&label=npm)](https://www.npmjs.com/package/lurqrun)
[![npm downloads](https://img.shields.io/npm/dm/lurqrun?color=%230b7285)](https://www.npmjs.com/package/lurqrun)
[![license](https://img.shields.io/badge/license-MIT-blue)](LICENSE)
[![node](https://img.shields.io/badge/node-%3E%3D20-339933?logo=node.js&logoColor=white)](https://nodejs.org)
[![MCP](https://img.shields.io/badge/MCP-compatible-6E56CF)](https://modelcontextprotocol.io)

[Quick start](#quick-start) · [MCP tools](#mcp-tools) · [CLI](#cli) · [Autopilot](#autopilot) · [How ranking works](#how-ranking-works) · [Docs](https://lurq.run/docs)

</div>

---

## Why

Your agent is terrible at resolving dependency matrices and maintaining old projects, leading to stack version drift. 

lurq reads the shipped code instead and caches it so we can diff surfaces across versions. lurq upgrades stacks and reports failures before they can even happen. lurq is what the agent checks first when planning, updating, or deploying any project.

lurq's information comes from readable and executable sources. These include analyzing advisories, release cadence, deprecations, and sandboxing. Compatibility edges are
minted continuously and stored in a Postgres database. Responses are
compact and token-budgeted so lurq works alongside your agent. 

> **Scope:** the JavaScript/TypeScript web stack (npm) only.

---

## Quick start

lurq is a **hosted service** — you don't run a database or a sync. One command,
with nothing installed first:

```bash
npx lurqrun
```

This command runs the guided setup, allowing you to sign in and validate your system with an API key. lurq automatically 
detects your installed assistants and writes a remote MCP entry.

```json
{
  "type": "http",
  "url": "https://api.lurq.run/mcp",
  "headers": { "Authorization": "Bearer ..." }
}
```

**No database credentials ever touch your machine.** Restart your agent afterward.

### The `lurq` command

The package is published as **`lurqrun`**. The command you type is `lurq`, and it exists only once the package is
installed.

```bash
npm install -g lurqrun     # then `lurq` works in any terminal
lurq --version
```

<details>
<summary><b>Supported assistants</b></summary>

Claude Code · Cursor · Windsurf · VS Code / Copilot · Codex · Gemini CLI ·
Antigravity · Kiro

Target one explicitly with `npx lurqrun install-skill --agent <name>`, or
self-host against your own database with `--local`.

</details>

<details>
<summary><b>Uninstall, or start over</b></summary>

**Reinstall** is just setup again. It is safe to re-run and overwrites previous runs.

```bash
npx lurqrun
```

**Uninstall** is three separate things, because setup writes to three places:

```bash
lurq logout                # forget the API key (~/.lurq/config.json)
npm uninstall -g lurqrun   # remove the `lurq` command
```

The third is the MCP entries in your agents' config files. Delete the `lurq` entry from whichever of these you
use:

| Assistant | MCP config | Instructions file |
|---|---|---|
| Claude Code | `~/.claude.json` | `~/.claude/skills/lurq/SKILL.md` |
| Cursor | `~/.cursor/mcp.json` | |
| Windsurf | `~/.codeium/windsurf/mcp_config.json` | `~/.codeium/windsurf/memories/global_rules.md` |
| VS Code / Copilot | `<VS Code user dir>/mcp.json` | |
| Codex | `~/.codex/config.toml` | `~/.codex/AGENTS.md` |
| Gemini CLI | `~/.gemini/settings.json` | `~/.gemini/GEMINI.md` |
| Antigravity | `~/.gemini/config/mcp_config.json` | `~/.gemini/GEMINI.md` |
| Kiro | `~/.kiro/settings/mcp.json` | `~/.kiro/steering/lurq.md` |

`lurq logout` **only** clears the key stored for the CLI. A copy of it
lives in each MCP entry above, so revoke the key from
[the dashboard](https://lurq.run/dashboard/keys).

</details>

---

## MCP tools

lurq can call these tools over MCP. Every response
carries a `dataAsOf` timestamp so your agents know how fresh the information is. 

| Tool | What it answers |
|---|---|
| `recommend` | Best current packages for a described need (≤5, scored, with confidence) |
| `evaluate` | Full evidence read for one package — scores, advisories, usage guide |
| `compare` | 2–5 packages ranked head-to-head |
| `verify` | Is this package real, healthy, and not risky? *(anti-hallucination guard)* |
| `compat` | Will these packages actually install together? (peer/engine constraints) |
| `plan` | Source every slot in a stack at once, checked for cross-slot coherence |
| `diagram` | A reference-architecture Mermaid diagram for a stack |
| `usage` | A version's *real* public API — symbols and signatures from its shipped `.d.ts` |
| `resolve_surface` | The exact export surface of one package version |
| `diff_surface` | What a version bump adds, removes, renames, or changes arity on |
| `report_outcome` | What happened after a pick shipped — installed clean, broke the build, resolved the task |

`usage` outputs the delta between your agent's analysis of a package versus lurq's ground truth. That fact
exists in no changelog and no model's training data.

---

## CLI

The same index, scriptable. Every capability is a subcommand.

```bash
# Discovery
lurq recommend "a form library for react"
lurq evaluate zod
lurq compare date-fns dayjs moment
lurq verify jsonwebtoken

# API surfaces
lurq usage zod --known 3.22.4              # what changed since the version you know
lurq versions react                        # stored version timeline

# Stacks
lurq compat next react react-dom           # do these install together?
lurq plan ./project.md                     # a description in, a scored stack out

# Upgrades
lurq upgrade-plan .                        # what's behind, and what each upgrade removes
lurq check-upgrade . --plan lurq-plan.json --exit-code

# Shipping your own (the same diff, pointed the other way)
lurq check-release                         # is the version you're about to publish honest?
lurq check-api --against origin/main       # does this break the callers of your API?

# Finding your way around
lurq can "will this upgrade break my code" # which lurq capability answers this?

# Configuration & serving
lurq weights                               # the exact ranking weights, printed
lurq edit-weights --set composite.lambda=0.5
lurq serve-http                            # run it as a rate-limited service of your own
```

Use the '-- json ' flag for every read command.

---

## Autopilot

lurq also keeps a repository's dependencies current **and rewrites the code an
upgrade breaks.**

lurq can open PRs addressing the symbol-level API surface diff 
and resolve with what calls your code references.

**The gate needs no tests at all.**

```
blocking   a referenced symbol disappears      → the code will throw
warning    a referenced symbol changed arity   → it may silently misbehave
ok         nothing referenced is affected
unverified could not be established            → never counted as safe
```

### The loop

| Step | Runs on | Needs |
|---|---|---|
| 1. `lurq upgrade-plan` — drift + what each upgrade removes | your runner | lurq key |
| 2. `lurq check-upgrade` — intersect with your source, `file:line` | your runner | nothing |
| 3. `claude-code-action` — rewrite the named call sites, run your tests | your runner | Anthropic credential |
| 4. `create-pull-request` — one branch, one PR | your runner | `GITHUB_TOKEN` |
| 5. Outcomes post back — names and counts, never source | lurq | — |

Steps 1–2 are the default and are also available on the web app through project autopilot. The generated workflow starts in `comment` mode: it
plans, checks, and writes the brief to the run summary. Editing
is opt-in per repository. Click the policy tab to set global security parameters. 

### Trust model

- **lurq's GitHub App is `Contents: read-only` and stays that way.** It cannot
  write to any repository, ever.
- **Every write uses your own `GITHUB_TOKEN`** — ephemeral, scoped to one repo,
  limited to the `permissions:` block in your committed file.
- **The agent cannot touch version control.** Its allowlist is
  `Read,Edit,Write,Bash(<pkg-manager>:*)`. Your agent can only edit
  files. 
- **Revoking it is `git rm .github/workflows/lurq-upgrade.yml`.**

Architecture and limits: [`docs/lurq-autopilot.md`](docs/lurq-autopilot.md).

---

## Where the evidence comes from

**Readable** — npm, GitHub, deps.dev, and OSV, re-synced daily. Downloads, release
cadence, maintenance, advisories, deprecations, license, bundle cost. 

**Executed** — an isolated sandbox (E2B, with a local driver for trusted work) that
installs and imports a package version. Results are recorded in the compatibility matrix.
Compatibility is established through co-installation. `compat` and `plan` read those edges, which is why lurq can tell you 
that an entire stack holds together.

Executable proof allows lurq to look beyond changelogs and training data.

---

## How ranking works

Deterministic, and public. **No model sits in the ranking path** — `recommend` is
hybrid vector + full-text search over precomputed scores, which is why lurq is fast,
cheap, and reproducible.

```
health  = maintenance 0.35 · adoption 0.30 · reliability 0.25 · efficiency 0.10
quality = types · tests · docs · changelog · dep count · license · provenance
composite = blend at a single tunable λ (default 0.35)
```

`quality` is a separate, **adoption-independent** axis.

Every weight lives in [`src/scoring/weights.ts`](src/scoring/weights.ts) and is
printable with `lurq weights`.

---

## Contact

Inquiries, partnerships, or proposals: **jadenryu@lurq.run**

## License

[MIT](LICENSE)
