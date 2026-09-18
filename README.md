<div align="center">

# lurq

**The verification layer for everything your agent installs.**

Your coding agent picks npm packages from memory. lurq checks them against the live
registry, security advisories, shipped type definitions and real co-installs, before
anything lands in `package.json`.

[![npm version](https://img.shields.io/npm/v/lurqrun?color=%230b7285&label=npm)](https://www.npmjs.com/package/lurqrun)
[![npm downloads](https://img.shields.io/npm/dm/lurqrun?color=%230b7285)](https://www.npmjs.com/package/lurqrun)
[![MCP Registry](https://img.shields.io/badge/MCP_Registry-io.github.jadenryu%2Flurq-6E56CF)](https://registry.modelcontextprotocol.io/v0/servers?search=io.github.jadenryu/lurq)
[![license](https://img.shields.io/badge/license-MIT-blue)](LICENSE)
[![node](https://img.shields.io/badge/node-%3E%3D20-339933?logo=node.js&logoColor=white)](https://nodejs.org)

[Install](#install) · [For AI agents](#for-ai-agents) · [MCP tools](#mcp-tools) · [CLI](#cli) · [Autopilot](#autopilot) · [Docs](https://www.lurq.run/docs)

</div>

```text
$ lurq verify lodahs
lodahs  ✗ do not install 0.0.1-security (latest) without review
  • name closely mimics "lodash" — possible typosquat
  • 1 critical/high advisory(ies) recorded against this package
risk flags: possible-typosquat-of:lodash, low-downloads, single-maintainer, has-known-advisory

$ lurq verify zod
zod  ✓ no supply-chain problems found in 4.6.4 (latest)
weekly dl:  209.2M   confidence: proven   advisories: 0

$ lurq compat next @auth/core next-auth
next + @auth/core + next-auth  conflict
peer-deps  next-auth needs peer @auth/core@0.34.3, but the stack uses @auth/core@0.41.3
```

Real output, not a mockup. Your agent gets the same answers over MCP.

---

## Why your agent needs this

A model's knowledge of npm stops at its training cutoff. The registry doesn't.

- **Invented and typosquatted names.** Agents confidently install packages that don't exist, or that
  exist only because someone registered the misspelling.
- **APIs that moved.** Of the 38,752 packages lurq tracks, 2,725 shipped a new major version between
  May 1 and September 13, 2026. Code written from memory calls functions that were renamed or removed.
- **Stacks that don't install together.** Every package can be healthy on its own while the set
  fails on a peer or engine range. That usually surfaces at deploy.

lurq answers from evidence it can show: **47,238 packages scored, 4.2M versions tracked, 34,843 API
surfaces extracted from shipped code, and 27M co-install pairs**, refreshed daily from npm, GitHub,
deps.dev and OSV. Every answer carries a `dataAsOf` timestamp.

> **Scope:** the JavaScript/TypeScript ecosystem (npm).

---

## Install

One command, once per machine. Nothing to install first:

```bash
npx lurqrun
```

The setup wizard:

1. Opens lurq in your browser. Sign in and the key comes back to the terminal by itself.
2. Detects every coding agent on the machine.
3. Writes a keyed remote MCP entry for each, in the shape that agent expects.
4. Installs standing instructions where the agent supports them, so it reaches for lurq instead of
   answering from memory.

Restart your agent afterward. **The free plan includes 1,000 hosted calls a month and never asks
for a card.**

**Works with:** Claude Code · Cursor · Windsurf · VS Code / GitHub Copilot · OpenAI Codex CLI ·
Gemini CLI · Google Antigravity · Kiro

**Check it worked:** ask your agent to *"add zod to this project"*. It should call lurq's `verify`
before installing anything.

**Claude Code plugin**, no terminal needed:

```text
/plugin marketplace add jadenryu/lurq
/plugin install lurq@lurq
```

One-click links for Cursor and VS Code are in the
[quickstart](https://www.lurq.run/docs/quickstart#one-click-install).

The package is published as **`lurqrun`** (the bare name was taken). The command is `lurq`:

```bash
npm install -g lurqrun
lurq --version
```

---

## For AI agents

If you are an AI coding agent and your user asked you to set up lurq, follow these steps.

**1. Run setup.**

```bash
npx lurqrun setup
```

In your shell it does not prompt: it prints a one-time sign-in link and exits right away. Give the
user that link. When they sign in on this computer, lurq stores a key and connects every detected
coding agent by itself. Never invent a key.

**2. Or configure non-interactively** when the user already has a key from
[lurq.run/dashboard/keys](https://www.lurq.run/dashboard/keys), or on a cloud, SSH or CI machine, where
a sign-in link on this computer can't work:

```bash
npx lurqrun setup --yes --no-open --api-key <key> --agent <id>
```

| Agent | `--agent` |
|---|---|
| Claude Code | `claude-code` |
| Cursor | `cursor` |
| Windsurf | `windsurf` |
| VS Code / GitHub Copilot | `copilot` |
| OpenAI Codex CLI | `codex` |
| Gemini CLI | `gemini-cli` |
| Google Antigravity | `antigravity` |
| Kiro | `kiro` |

`--agent all` configures every detected agent. With `--yes`, the key can also come from `LURQ_API_KEY`.

Some checks need no key at all. `npx lurqrun check-upgrade --upgrade <package>@<from>..<to>` compares an
upgrade against the names your code actually imports, locally.

**3. Tell the user to restart the agent**, then confirm `lurq` appears in its MCP tool list.

<details>
<summary><b>Writing the MCP config by hand</b></summary>

Endpoint: `https://api.lurq.run/mcp` (streamable HTTP), header `Authorization: Bearer <key>`. The
field names differ by client:

**Claude Code** (`~/.claude.json`, under `mcpServers`) and **VS Code** (`mcp.json`, under `servers`):

```json
"lurq": { "type": "http", "url": "https://api.lurq.run/mcp", "headers": { "Authorization": "Bearer <key>" } }
```

**Cursor** (`~/.cursor/mcp.json`) and **Kiro** (`~/.kiro/settings/mcp.json`), under `mcpServers`:

```json
"lurq": { "url": "https://api.lurq.run/mcp", "headers": { "Authorization": "Bearer <key>" } }
```

**Windsurf** (`~/.codeium/windsurf/mcp_config.json`) and **Antigravity** (`~/.gemini/config/mcp_config.json`), under `mcpServers`:

```json
"lurq": { "serverUrl": "https://api.lurq.run/mcp", "headers": { "Authorization": "Bearer <key>" } }
```

**Gemini CLI** (`~/.gemini/settings.json`, under `mcpServers`). It must be `httpUrl`, because a
plain `url` is read as SSE:

```json
"lurq": { "httpUrl": "https://api.lurq.run/mcp", "headers": { "Authorization": "Bearer <key>" } }
```

**Codex** (`~/.codex/config.toml`). Headers go in an inline table:

```toml
[mcp_servers.lurq]
url = "https://api.lurq.run/mcp"
http_headers = { Authorization = "Bearer <key>" }
```

</details>

### When to call lurq

| You are about to… | Call |
|---|---|
| Install or import a package | `verify` with the exact name, first |
| Choose between libraries | `compare` your candidates, then `verify` the pick |
| Commit to a set of packages | `compat` with the whole set in one call |
| Write code against a package whose API may have moved | `usage`, with the version you remember as `knownVersion` |
| Upgrade, or explain a break | `diff_surface` between the two versions |
| Add dependencies in a team codebase | `policy`, before choosing |
| Review a whole project | `audit` with names and versions from `package.json` and the lockfile |
| Wire an MCP server into an agent | `mcp_surface`, or `mcp_stack` for several |
| Not sure which tool fits | `capabilities` |

When lurq flags something, tell the user what it found and that it came from lurq. An `unknown` or
`UNVERIFIABLE` result means lurq could not check. It never means the package is clean.

Machine-readable docs: [lurq.run/llms.txt](https://www.lurq.run/llms.txt) ·
[lurq.run/docs/llms-full.txt](https://www.lurq.run/docs/llms-full.txt)

---

## MCP tools

Fifteen tools. Responses are compact to save tokens, and package answers carry `dataAsOf`.

**Before installing**

| Tool | What it answers |
|---|---|
| `verify` | Is this package real, healthy and safe? Catches hallucinated and typosquatted names |
| `evaluate` | The full evidence for one package: scores, advisories, usage guide, sandbox verdict |
| `compare` | 2–5 packages ranked head-to-head |
| `policy` | What your team's selection policy refuses, so the agent picks an allowed package first |

**Across a stack**

| Tool | What it answers |
|---|---|
| `compat` | Will these packages install together? Returns the exact clashing peer or engine range |
| `audit` | A whole project's outdated, deprecated and vulnerable dependencies and drifted MCP servers, in one call |
| `diagram` | A reference-architecture Mermaid diagram for a stack |

**Writing code**

| Tool | What it answers |
|---|---|
| `usage` | A version's real public API from its shipped `.d.ts`, and what changed since the version you know |
| `resolve_surface` | What a version actually exports at runtime |
| `diff_surface` | What a version bump adds, removes, renames or changes arity on |

**MCP servers**

| Tool | What it answers |
|---|---|
| `mcp_surface` | A server's real tool contract, from a live `tools/list` handshake, including what each tool can write or reach |
| `mcp_drift` | What a server changed between two versions |
| `mcp_stack` | Do these servers collide in one agent's tool namespace? |

**About lurq**

| Tool | What it answers |
|---|---|
| `capabilities` | Which lurq tool answers this situation |
| `report_outcome` | What happened after a pick shipped, which feeds future rankings |

Inputs, outputs and verdict definitions for each: [MCP tools reference](https://www.lurq.run/docs/mcp-tools).

---

## CLI

The same index, scriptable. Every read command takes `--json`.

```bash
# Before installing
lurq verify jsonwebtoken
lurq evaluate zod
lurq compare date-fns dayjs moment

# Stacks and projects
lurq compat next react react-dom
lurq audit .                               # every dependency and MCP server in the project

# APIs and upgrades
lurq usage zod --known 3.22.4              # what changed since the version you know
lurq upgrade-plan .                        # what's behind, and what each upgrade removes
lurq check-upgrade . --plan lurq-plan.json --exit-code

# Publishing your own package
lurq check-release                         # is the version you're about to publish honest?
lurq check-api --against origin/main       # does this break your API's callers?

# MCP servers
lurq mcp-scan                              # read the servers you have configured, record what changed

# Team policy
lurq policy pull policy.json               # keep the selection policy in a reviewed file
lurq policy push policy.json               # and apply it from CI (needs a policy:write key)

# Finding your way
lurq can "will this upgrade break my code" # which capability answers this?
```

Full reference: [CLI docs](https://www.lurq.run/docs/cli).

---

## Autopilot

lurq keeps a repository's dependencies current, and names the code an upgrade breaks before it merges.

The check reads the symbol-level API diff between versions and matches it against what your code
actually references. **It needs no tests.**

```
blocking   a referenced symbol or deep import disappears,
           or require() of a now-ESM package breaks         → the code will throw
warning    a call's argument count no longer fits, a new type
           error, or a Node / peer version the repo lacks   → it may misbehave or not build
ok         nothing referenced is affected
unverified could not be established                         → never counted as safe
```

| Step | Runs on | Needs |
|---|---|---|
| 1. `lurq upgrade-plan`: drift, plus what each upgrade removes | your runner | lurq key |
| 2. `lurq check-upgrade`: matched against your source, with `file:line` | your runner | nothing |
| 3. `lurq fix`: applies what the package itself proves — renames, and the range bump in every manifest | your runner | nothing |
| 4. `claude-code-action`: migrates what a rule cannot, and runs your tests | your runner | Anthropic credential |
| 5. `create-pull-request`: one branch, one PR | your runner | `GITHUB_TOKEN` |
| 6. Outcomes post back: names and counts, never source | lurq | nothing |

**Three modes, and editing is opt-in.** The workflow starts in `comment`: it plans, checks, writes the
brief to the run summary, and changes nothing. `fix` opens a pull request containing only what the
package itself proves — renamed call sites, and the range bump in every manifest — so it needs **no
Anthropic credential**, and it is what a newly armed repo gets. `pr` is `fix` plus the agent, for the
changes a rule cannot make. Step 4 above is the only one that needs a model, so only `pr` does.

The dashboard setting governs repos that already installed the workflow: each run reads the mode from
the plan response rather than from the committed file.

Cadence follows scope — weekly for the scopes that track breakage, since majors arrive slowly enough
that a daily run mostly reports nothing new; daily for a repo set to advisories-only, because weekly
can mean seven days sitting on a known CVE.

**Trust model.** lurq's GitHub App holds `Contents: read-only` and `Actions: write`. It can read your
manifests and *start* the workflow you committed — it cannot write a byte to your repository, change
this file, or set a repository variable. Every write is made by the workflow itself using your own
ephemeral `GITHUB_TOKEN`, bounded by the `permissions:` block in the file you control. The agent's allowlist is
`Read,Edit,Write,Bash(<pkg-manager>:*)`, so it edits files but never touches version control.
Removing it is `git rm .github/workflows/lurq-upgrade.yml`.

---

## What leaves your machine

Package names and versions, never your source code. `audit` receives the inventory your agent reads
locally, `check-upgrade` matches symbols against your code on your own runner, and outcomes report
names and counts only.

`lurq mcp-scan` is the one exception worth knowing: by default it records what your MCP servers
expose (tool names, descriptions and parameters, with secrets redacted) to your account, so it can
tell you what changed. `--no-upload` keeps the scan on your machine.

---

## Where the evidence comes from

**Readable:** npm, GitHub, deps.dev and OSV, re-synced daily. Downloads, release cadence,
maintenance, advisories, deprecations, license and bundle cost.

**Executed:** an isolated sandbox installs and imports package versions and records the results in a
compatibility matrix. `compat` reads those edges alongside declared peer and engine ranges, which is
why lurq can say whether a whole stack holds together.

**Ranking is deterministic and public.** No model sits in the scoring path:

```
health    = maintenance 0.35 · adoption 0.30 · reliability 0.25 · efficiency 0.10
quality   = types · tests · docs · changelog · dep count · license · provenance
composite = blend at a single tunable λ (default 0.35)
```

Every weight lives in [`src/scoring/weights.ts`](src/scoring/weights.ts) and prints with `lurq weights`.

---

## Plans

| Plan | Price | Hosted calls |
|---|---|---|
| Free | $0 | 1,000 a month |
| Pro | $15/mo | 10,000 a month |
| Team | $25/seat/mo, 3-seat minimum | 15,000 per seat, pooled |
| Business | from $1,000/mo | Uncapped, with SSO and audit export |

Past the limit, calls slow to 20 a day rather than stopping. The CLI run against your own database
is never metered. Details: [pricing](https://www.lurq.run/#pricing).

---

<details>
<summary><b>Uninstall, reinstall, and where setup writes</b></summary>

Setup is safe to re-run: `npx lurqrun` again overwrites the previous entries.

```bash
lurq uninstall                  # MCP entries, agent instructions, the stored key
lurq uninstall --agent cursor   # just one agent
npm uninstall -g lurqrun        # then remove the `lurq` command
```

It lists what it will remove and asks first (`--yes` skips the question).

| Agent | MCP config | Instructions |
|---|---|---|
| Claude Code | `~/.claude.json` | `~/.claude/skills/lurq/SKILL.md` |
| Cursor | `~/.cursor/mcp.json` | none (tool descriptions carry the guidance) |
| Windsurf | `~/.codeium/windsurf/mcp_config.json` | `~/.codeium/windsurf/memories/global_rules.md` |
| VS Code / Copilot | `<VS Code user dir>/mcp.json` | none |
| Codex | `~/.codex/config.toml` | `~/.codex/AGENTS.md` |
| Gemini CLI | `~/.gemini/settings.json` | `~/.gemini/GEMINI.md` |
| Antigravity | `~/.gemini/config/mcp_config.json` | `~/.gemini/GEMINI.md` |
| Kiro | `~/.kiro/settings/mcp.json` | `~/.kiro/steering/lurq.md` |

`lurq logout` only clears the CLI's stored key. A copy stays in each MCP entry until `lurq uninstall`
removes it, and the key keeps working until you revoke it in
[the dashboard](https://www.lurq.run/dashboard/keys).

</details>

<details>
<summary><b>Self-hosting</b></summary>

lurq runs against your own Postgres too: `lurq serve` (stdio MCP) or `lurq serve-http` (a
rate-limited HTTP service), with `DATABASE_URL` set. The published CLI installs only what hosted use
needs; the first self-hosting command prints the exact `npm install` line for the server packages.
Guide: [self-hosting](https://www.lurq.run/docs/self-hosting).

</details>

---

## Contact

Inquiries, partnerships or proposals: **jadenryu@lurq.run**

## License

[MIT](LICENSE)
