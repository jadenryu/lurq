<div align="center">

# lurq

**Execution-verified dependency intelligence for AI coding agents.**

A live index of npm scored from public signals, plus a sandbox that settles the
questions metadata can't — exposed as an MCP server, a CLI, an HTTP API, and an
installable agent skill.

[![npm version](https://img.shields.io/npm/v/lurqrun?color=%230b7285&label=npm)](https://www.npmjs.com/package/lurqrun)
[![npm downloads](https://img.shields.io/npm/dm/lurqrun?color=%230b7285)](https://www.npmjs.com/package/lurqrun)
[![license](https://img.shields.io/badge/license-Apache--2.0-blue)](LICENSE)
[![node](https://img.shields.io/badge/node-%3E%3D20-339933?logo=node.js&logoColor=white)](https://nodejs.org)
[![MCP](https://img.shields.io/badge/MCP-compatible-6E56CF)](https://modelcontextprotocol.io)

[Quick start](#quick-start) · [MCP tools](#mcp-tools) · [CLI](#cli) · [Autopilot](#autopilot) · [How ranking works](#how-ranking-works) · [Docs](https://lurq.run/docs)

</div>

---

## Why

Your agent picks the dependencies now, and it picks them from training data frozen
at its cutoff, ranked by how often a name appeared in text — not by whether the
package is healthy today. So agents install libraries that are abandoned, carry
open advisories, or don't exist at all.

lurq is what the agent checks first.

Most of what matters is readable — release cadence, advisories, deprecations,
types/tests/docs, bundle cost — and lurq ingests all of it daily. The rest isn't
readable at all. Whether a package installs cleanly, whether it imports without
throwing, whether two versions can coexist in one tree: those are only knowable by
running them, so lurq runs them in an isolated sandbox and keeps the result.

lurq recommends and explains packages; your agent writes the code. Responses are
compact and token-budgeted, built for a context window rather than a screen.

> **Scope:** the JavaScript/TypeScript web stack (npm) only.

---

## Quick start

lurq is a **hosted service** — you don't run a database or a sync.
[Create a free account](https://lurq.run/sign-up) to generate an API key, then run
the guided installer:

```bash
npx lurqrun install
```

It prompts for your key, validates it, detects your installed assistants, and
writes a keyed remote MCP entry:

```json
{
  "type": "http",
  "url": "https://api.lurq.run/mcp",
  "headers": { "Authorization": "Bearer ..." }
}
```

**No database credentials ever touch your machine.** Restart your agent afterward.

<details>
<summary><b>Supported assistants</b></summary>

Claude Code · Cursor · Windsurf · VS Code / Copilot · Codex · Gemini CLI ·
Antigravity · Kiro

Target one explicitly with `npx lurqrun install-skill --agent <name>`, or
self-host against your own database with `--local`.

</details>

---

## MCP tools

Once installed, your agent can call these over MCP. Every response is compact and
carries a `dataAsOf` timestamp.

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

`usage` is the one worth calling out: pass the version your model *thinks* it knows
and get the precise delta to the version you're actually installing. That fact
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

# Configuration & serving
lurq weights                               # the exact ranking weights, printed
lurq edit-weights --set composite.lambda=0.5
lurq serve-http                            # run it as a rate-limited service of your own
```

Every read command takes `--json`.

---

## Autopilot

lurq also keeps a repository's dependencies current **and rewrites the code an
upgrade breaks.**

Renovate and Dependabot open a PR that says *"bumped react-router 6→8"* and gate it
on your test suite. If coverage misses the affected path, the PR merges green and
breaks in production.

lurq opens a PR that says *"bumped react-router 6→8, and rewrote the 14 call sites
that used `useHistory`, which no longer exists"* — because it holds the
symbol-level surface diff and intersects it with what your code references.

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

Steps 1–2 are the default. The generated workflow starts in `comment` mode: it
plans, checks, and writes the brief to the run summary, changing nothing. Editing
is opt-in per repository.

### Trust model

- **lurq's GitHub App is `Contents: read-only` and stays that way.** It cannot
  write to any repository, ever.
- **Every write uses your own `GITHUB_TOKEN`** — ephemeral, scoped to one repo,
  limited to what the `permissions:` block in a file *you* committed declares.
- **The agent cannot touch version control.** Its allowlist is
  `Read,Edit,Write,Bash(<pkg-manager>:*)` — no `git`, no network. The model edits
  files; the *workflow* commits. A prompt injection in a dependency's changelog
  cannot push a branch.
- **Revoking it is `git rm .github/workflows/lurq-upgrade.yml`.**

Architecture and limits: [`docs/lurq-autopilot.md`](docs/lurq-autopilot.md).

---

## Where the evidence comes from

Two sources, and the distinction is the whole point.

**Readable** — npm, GitHub, deps.dev, and OSV, re-synced daily. Downloads, release
cadence, maintenance, advisories, deprecations, license, bundle cost. This is what
scoring runs on.

**Executed** — an isolated sandbox (E2B, with a local driver for trusted work) that
installs a package version, imports it, and records what happened. Co-installing a
set is how compatibility is established: a successful co-install is positive proof
two versions coexist, a failure is proof they conflict, and the error is kept as
evidence. `compat` and `plan` read those edges, which is why lurq can tell you a
*stack* holds together rather than only that each package looks fine alone.

Facts of the second kind appear in no changelog and no model's training data, and
they go stale unless someone keeps re-running the experiment.

---

## How ranking works

Deterministic, and public. **No model sits in the ranking path** — `recommend` is
hybrid vector + full-text search over precomputed scores, which is why it's fast,
cheap, and reproducible.

```
health  = maintenance 0.35 · adoption 0.30 · reliability 0.25 · efficiency 0.10
quality = types · tests · docs · changelog · dep count · license · provenance
composite = blend at a single tunable λ (default 0.35)
```

`quality` is a separate, **adoption-independent** axis, so a well-built new package
isn't buried by an old popular one.

Every weight lives in [`src/scoring/weights.ts`](src/scoring/weights.ts) and is
printable with `lurq weights`. An answer an agent acts on is worth nothing if it
can't be audited.

---

## Contact

Inquiries, partnerships, or proposals: **jadenryu@gmail.com**

## License

[Apache-2.0](LICENSE)
