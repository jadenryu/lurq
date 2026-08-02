# lurq

> the marketplace layer for AI coding agents. a live, evidence-ranked index of every npm package, exposed as an mcp server, a cli, an http api, and an installable agent skill — compatible with claude code, cursor, windsurf, vscode/copilot, and codex.

your agent picks the dependencies now, and it picks them from training data frozen at its cutoff and ranked by how often a name appeared in text — not by whether the package is healthy today. so agents install libraries that are abandoned, carry open advisories, or don't exist at all.

lurq is the market that decision runs through. **demand side:** agents ask lurq before they choose. **supply side:** every published package is listed automatically and ranked on public evidence — release cadence, advisories, deprecations, types/tests/docs, bundle cost, resolved peer compatibility — recomputed daily. placement is not for sale, at any price; the ranking is the only asset the market has.

lurq recommends and explains packages; your agent writes the code. responses are compact and token-budgeted, built for an agent's context window rather than a human's screen.

**v1 scope:** the javascript/typescript web stack (npm) only.

---

## quick start: connect your agent

> **not public yet.** the published build (`lurqrun@0.0.5`) is still behind the pre-launch gate — anyone can install it, but running a command shows a placeholder. [join the waitlist](https://lurq.run); the steps below are how it works at launch.

lurq is a **hosted service**: you don't run a database or a sync. get an API key,
then run the guided installer:

```bash
npx lurqrun install
```

it prompts for your key, validates it, detects your installed assistants
(claude code, cursor, windsurf, vscode/copilot, codex), and writes a keyed
remote mcp entry:
`{ "type": "http", "url": "https://api.lurq.run/mcp", "headers": { "Authorization": "Bearer …" } }`.
**no database credentials ever touch your machine.** restart your agent afterward.

## what your agent gets (mcp tools)

once installed, the agent can call these over mcp. every response is compact and
carries a `dataAsOf` timestamp.

- **`recommend`**: best current packages for a described need (≤5, scored, with confidence)
- **`evaluate`**: full evidence read for one package (scores, advisories, usage guide)
- **`compare`**: 2 to 5 packages ranked head-to-head
- **`verify`**: is a package real, healthy, and not risky? (anti-hallucination guard)
- **`compat`**: will these packages actually install together? (peer/engine constraints)
- **`plan`**: source every slot in a stack at once, checked for cross-slot coherence
- **`diagram`**: a reference-architecture mermaid diagram for a stack
- **`usage`**: a package version's *real* public api — exported symbols and signatures extracted from its shipped `.d.ts`, exact to the version and absent from any model's training data. pass the version your model knows and get the precise delta: what was added, removed, renamed, or changed.
- **`report_outcome`**: what happened after a pick shipped — installed clean, broke the build, resolved the task. these reports re-rank the market, so it learns from real usage instead of popularity.

## cli

the same index, scriptable. every capability is a subcommand:

```bash
lurq recommend "a form library for react"
lurq verify jsonwebtoken
lurq compare date-fns dayjs moment
lurq compat next react react-dom          # do these install together?
lurq usage zod --known 3.22.4             # what changed in the api since?
lurq plan ./project.md                    # a description in, a scored stack out
lurq serve-http                           # run it as a rate-limited service of your own
lurq weights                              # the exact ranking weights, printed
```

## how the ranking works

deterministic, and public. no model sits in the ranking path — `recommend` is hybrid
vector + full-text search over precomputed scores, which is why it's fast, cheap, and
reproducible.

- **health** = maintenance `0.35` · adoption `0.30` · reliability `0.25` · efficiency `0.10`
- **quality** is a separate, adoption-independent axis — types, tests, docs, changelog,
  dependency count, license, provenance — so a well-built new package isn't buried by an
  old popular one
- the two blend at a single tunable λ for the default sort

every weight lives in [`src/scoring/weights.ts`](src/scoring/weights.ts) and is printable with
`lurq weights`. an agent-facing ranking is worth nothing if it can't be audited.

## outreach

for any inquiries, partnerships, or proposals, contact jaden ryu at jadenryu@gmail.com.

## license

Apache License 2.0
