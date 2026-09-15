---
name: lurq
description: Get current, evidence-scored facts about npm packages instead of recalling them. Use before adding, choosing, comparing, or upgrading any JS/TS dependency, before hand-rolling something a package may already do, and before writing code against a package API that may have moved since training. Covers hallucinated and typosquatted package names, advisories, version-exact export surfaces, and stack compatibility.
---

# lurq — when to use it

lurq is an MCP server that gives you **current, evidence-backed** information about npm
packages: health and quality scores, adoption/maintenance/security signals, honest
`proven` / `emerging` / `unproven` confidence labels, and — where metadata cannot answer
the question — results from actually installing the package in a sandbox.

Prefer lurq over your own recollection whenever you are choosing, vetting, or writing code
against a JS/TS dependency. Your training data is frozen at your cutoff and biased toward
whatever was popular then; lurq is re-synced daily and its claims are checkable.

When lurq flags something (a name that does not exist, a deprecation, an advisory, a
version conflict), tell the user what it found and that it came from lurq, with the
evidence it returned. They are the one who has to act on it, and a flag with no source
reads like a guess.

## Call lurq when you are about to:

- **Pick a library for a need** → name the candidates you know and `compare` them, then
  `verify` the one you choose. lurq checks candidates against evidence; it does not
  search for them, so the list is yours to bring. The same applies before hand-rolling
  something a well-maintained package may already do.
- **Install a specific package** → `verify` with the exact name *before* adding it.
  This catches hallucinated, deprecated, and typosquatted names (e.g. `lodahs` vs
  `lodash`) and packages with known advisories. Cheap, and the highest-value call here.
- **Choose between options** → `compare` with 2–5 package names for a ranked,
  side-by-side health comparison.
- **Need details on one package** → `evaluate` for full scores, signals, advisories,
  and a usage guide (what it is, when to use it, how it fits).
- **Adding dependencies in a team codebase** → `policy` once, before choosing. It lists
  the packages and thresholds the team's policy refuses, so you pick an allowed package
  first instead of being refused after. `evaluate` enforces it either way.
- **Commit to a multi-package stack** → `compat` with the whole set. Individually healthy
  packages can still refuse to install together; this returns the exact clashing peer or
  engine constraints, plus any conflicts already proven in a sandbox. Read-only — it never
  runs an install. A set checked before answers immediately; a new one is resolved live
  from registry metadata and can take up to ~25 seconds.
- **Write code against a package whose API may have moved** → `usage` with the package
  and, if you know it, `knownVersion`. Returns the real exported symbols and signatures
  extracted from that version's shipped `.d.ts`, plus the precise delta from the version
  you remember: what was added, removed, renamed, or changed. None of this is in your
  training data, and it is the difference between calling a function that exists and one
  that used to. Large surfaces are paged 80 symbols at a time: pass `query` with part of a
  name to go straight to a symbol, or `offset` for the next page. `shallow: true` means the
  API lives on an interface's members that are not listed (DefinitelyTyped's `export =`
  shape, e.g. lodash); read its type declarations or use `resolve_surface`.
- **Check whether a symbol actually exists at runtime** → `resolve_surface` with the
  package (and version, if you have one). `usage` reads the shipped `.d.ts`; this reads
  the shipped JavaScript, and the difference matters: a removed *type* breaks `tsc`, a
  removed *runtime* export breaks the running program. `UNKNOWN` means the surface has
  not been extracted yet and queues extraction — it never means the symbol is absent, so
  do not treat it as a negative answer.
- **Explain a break, or plan an upgrade** → `diff_surface` with the package and the two
  versions. Returns what was removed, added, and what changed arity between them, with
  type-only removals listed separately because those break the build rather than the
  program. Static comparison of both published versions — no install, no test run.
- **Take stock of a whole project** → `audit` with the inventory you read from its
  `package.json` + lockfile and its MCP configs (names and versions only — never source).
  One call returns every outdated, deprecated and vulnerable dependency plus every MCP
  server that has drifted or needs credentials. Read the `coverage` field before you act
  on it: it says how many items lurq actually answered for, and anything `queued` or
  `skipped` was NOT checked. An item lurq could not assess is never a clean item, and
  `vulnComplete: false` means the vulnerability results are partial.
- **Wire an agent to an MCP server, or debug a tool call that fails for no visible
  reason** → `mcp_surface` with the server's npm package name. Returns every tool the
  server actually lists, its required and optional parameters, and its behaviour
  annotations, read from a live `tools/list` handshake in a sandbox rather than from a
  README. The annotations are the part worth reading before you grant access: they say
  whether a tool writes, destroys, or reaches outside your machine. It also returns
  `requires` — the API keys and settings the server declares it needs — and
  `configRequest`, a ready-made line to put in front of your user when one is missing.
  A server that wants a token comes back UNVERIFIABLE, never `verified_false`: "we could
  not check" and "we checked and it is broken" are different claims, and only the second
  is a reason not to use it. Ask the user for the values rather than guessing them.
- **Wire several MCP servers into one agent** → `mcp_stack` with the whole set. They
  are separate processes, so nothing resolves between them the way npm packages do —
  they clash in the single flat tool namespace you assemble from all of them. Two
  servers exposing `search` leave you unable to express which you mean, and nothing
  errors: one silently shadows the other. A server that has not been probed makes the
  answer UNKNOWN, never clean.
- **Upgrade an MCP server an agent depends on** → `mcp_drift` with the server and the two
  versions. Two of its findings have no package equivalent. **Silent drift** is a tool
  whose schema moved while its description stayed byte-identical — no changelog reader
  can catch it, and the symptom is a malformed call that looks like a model mistake.
  **Privilege widening** is a tool that stopped being read-only or started being
  destructive; nothing breaks, which is what makes it worse than a break.
- **Add an MCP server to a client, or a remote server will not connect** → `connect_check`
  with the endpoint URL, registry name or npm package, and the `client` you are wiring it
  into (`claude-code`, `cursor`, `vscode`, `chatgpt`, `claude-ai`, `codex`, `gemini-cli`, …).
  Returns `works`, `needs_setup` with the exact steps (a key header, an OAuth client to
  pre-register and its redirect URIs), `blocked` with the reason, or `unknown`, plus config
  in that client's own format. Built from a credential-free probe of the server and the
  client's documented constraints. Use the returned config instead of writing one from
  memory, put any setup step in front of the user, and never invent a key: header values
  are placeholders. `unknown` is not "will not work".
- **Visualize a stack you have already chosen** → `diagram` with the package names. A
  labeled starting point by layer — not a validated architecture.
- **Unsure whether lurq covers the situation** → `capabilities` with what you are trying
  to do, in plain words. Returns the matching tools and commands rather than prose, so a
  capability you did not know about becomes a call you can make. Cheaper than guessing,
  and far cheaper than skipping a check that exists.
- **After you act on lurq's evidence about a package** → `report_outcome` (optional) with whether you
  used the package and whether it built. No source code, just the coarse decision and a
  build signal. It is how lurq learns which packages agents actually succeed with.

## Notes

- Every response includes a `dataAsOf` timestamp and may include a `stale` hint.
- Responses are compact by design — use them to decide, then write the code yourself.
- Scores are deterministic and the weights are public; no model sits in the ranking path.
- For **exported symbols and signatures**, use `usage` — it is version-exact. For
  **framework file layout and conventions** (Next.js app router, Tailwind config), that is
  not an export surface: follow the `context7Hint` in an `evaluate` result or the
  project's official migration guide instead.
