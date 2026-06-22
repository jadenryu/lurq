# lurq — Feature Roadmap & Differentiation

> **Purpose:** Companion to `lurq-v1-master-spec.md`. The master spec defines the v1 build (recommend / evaluate / verify for npm SDKs via MCP). This document captures **(a) the validated competitive gap** and **(b) the additive feature roadmap** that turns lurq from "a recommender anyone could clone" into a genuine, scalable, necessary product. Nothing here changes v1 scope unless explicitly promoted into the master spec; this is the strategic layer above it.

---

## 1. Core identity (do not drift from this)

lurq is the **objective recommendation + evaluation layer that agentic coding assistants call at the moment they choose or wire up a dependency.** Recommendation (pick the best library for a need) is the engine; evaluation (is it healthy / proven / safe) is the supporting proof. lurq never sees the user's source code — it supplies fresh, objective, explained library knowledge the agent lacks.

**The organizing principle for every feature below:** *it should only make sense because lurq recommends.* If a feature doesn't deepen the recommend+evaluate job, it doesn't belong — it dilutes the identity or duplicates an incumbent.

---

## 2. The validated gap (mid-2026 snapshot)

Deep research (27 sources, adversarially verified) confirmed the space **"recommend + evaluate + agent-native"** is empty. Every adjacent product sits in only one or two of those three boxes:

| Product | Recommend? | Evaluate? | MCP / agent-native? |
|---|---|---|---|
| deps.dev (Google) | ❌ | ✅ factual/security | ❌ JSON/gRPC only |
| OpenSSF Scorecard | ❌ | ✅ security 0–10 | ❌ CLI/Action |
| Snyk (incl. 2026 Agent Security) | ❌ | ✅ security/governance | ⚠️ governs agents, doesn't recommend libs |
| Context7 / GitMCP | ❌ | ❌ docs only | ✅ |
| npm-compare / npm trends / Moiva | ⚠️ human "choose" | ⚠️ raw stats | ❌ human dashboards |
| Microsoft APM | ❌ | ❌ | ✅ but packages agent primitives, not SDK health |
| **lurq** | ✅ | ✅ | ✅ |

**Most threatening competitors** (not the security giants — different job):
1. **Context7 / GitMCP** — already MCP-native and README-grounded (lurq's exact mechanism); adding a health/recommend tool is their cheapest expansion. This is who lurq is racing.
2. **Microsoft APM** — owns the install surface (`.claude/`, `.cursor/`, `.github/`), big-vendor distribution; doesn't do SDK health today.

**Tailwinds:**
- **Matthew effect** (arXiv 2509.23261, Sept 2025): LLM code-generation success correlates with framework popularity (79.8% vs 24.3% Pass@1 across frameworks) — agents are structurally biased toward whatever was popular at training cutoff, the exact bias an objective fresh signal corrects.
- **Slopsquatting**: AI hallucinating fake package names into real supply-chain attacks — a fast-rising 2025–26 threat (Socket, Trend Micro, Mend, Cloud Security Alliance). lurq's `verify` kills this.

**Honest red flags (the strategic problem to solve):**
1. **The data is cheap to copy.** Every input (npm, GitHub, deps.dev, Scorecard) is a public API; deps.dev/Scorecard are *already* wrapped by unofficial MCP scrapers. The empty box is real today but not structurally defended. → Defensibility must come from signal the public APIs can't give (Tiers 2–3 below).
2. **Coverage gap in the research.** Socket, Libraries.io, Endor, Mend, Sonatype, Phylum, StackShare, Moiva were inferred from category, not primary-verified. **Socket** especially deserves a manual look before betting the framing.

**Open questions worth closing before heavy build:**
- Do Cursor / Copilot / Claude Code already do internal dependency-selection/scoring? (Would compress the wedge.)
- Given the Matthew effect, will agents *act* on a recommendation for a less-popular library if they generate worse code with it? (The wireability score in Tier 2 is partly the answer.)

---

## 3. Additive feature roadmap

Ranked by **necessity × scalability × defensibility × fit-to-identity.** Tiers 1–3 form one coherent product; Tier 4 is stack-level + the paying buyer.

### Tier 1 — extend recommendation into the moment *after* the pick

**1.1 Wire-up / setup generation for the recommended library**
- **Job:** agent picks a lib, then hallucinates outdated APIs / wrong config wiring it in.
- **Feature:** promote the ingest-time explainer into a `setup` output — minimal, version-correct install + init snippet for the *specific* package just recommended.
- **Fit:** recommendation is incomplete until the thing works; this is the natural second half of the same call.
- **Defensibility:** grounded on lurq's README + version data; sharpens with the wireability signal (1.x → 2.1).
- **Build:** **low** — surfaces data v1 already plans to compute.

**1.2 Deprecation → replacement recommendation ("X is dead, use Y")**
- **Job:** agents confidently recommend abandoned packages (Moment.js, request, etc.) because training data froze when they were popular.
- **Feature:** evaluate (unmaintained/archived/deprecated) → recommend (migrate to this successor) in one agent-callable step.
- **Fit:** the purest fusion of freshness + recommendation; nobody does this in one step.
- **Defensibility:** requires both maintenance scoring AND the recommendation graph — exactly the combination that's empty in the market.
- **Build:** **medium** — needs a seeded/learned successor mapping.

**1.3 Migration / breaking-change guidance between major versions**
- **Job:** agent works against v3 when v5 is current (or vice versa); major-version migration is a top recurring failure.
- **Feature:** version-aware change summary + migration recommendation (the delta to move safely).
- **Caveat:** most content-heavy; closest to overlapping Context7's version-docs territory. **Scope to change summaries + the migration recommendation, NOT full docs** — complement Context7, don't duplicate it.
- **Build:** **medium-high.**

### Tier 2 — agent-native metrics nobody computes (the real novelty)

**2.1 Agent-Wireability / generation-success score** ⭐ headline differentiator
- **Job:** not "is this library healthy" but "can an agent actually produce *working* code with it." Grounded in the Matthew-effect study.
- **Feature:** a sandboxed eval harness asks a model to wire the package up from scratch and run its smoke tests → a per-package agent-success score, kept **separate** from health (never conflate "healthy" with "agent-usable").
- **Fit:** makes recommendations trustworthy in agent hands — only surface a niche-but-better lib if it scores well here.
- **Defensibility:** **very high** — methodology + accumulated eval results, not a public-API wrapper. The thing competitors can't clone.
- **Build:** **high** (sandboxed eval infra) — but it's the moat.

### Tier 3 — the flywheel (compounds with usage)

**3.1 Recommendation → outcome capture** ⭐ most defensible asset
- **Job/asset:** lurq sits *inside the agent loop at the choice moment* — a position no security incumbent has. A lightweight opt-in callback (accepted? compiled? tests passed?) yields a recommendation→outcome dataset nobody else can reconstruct (they see deployed deps, not the decision).
- **Privacy:** no user code — just accept/reject + build-pass signal.
- **Defensibility:** **highest in the plan** — requires being where lurq already is.
- **Build:** **low to instrument, high to exploit.** → **Instrument from day one even if unused initially.**

### Tier 4 — stack-level + the paying buyer

**4.1 "Works-well-with" / compatibility-aware recommendation**
- **Job:** recommend a *coherent set* (ORM + validator + router known to ship together); flag peer-dep / version conflicts. Still slot-by-slot, **not** an architecture oracle.
- **Defensibility:** improves with flywheel data.
- **Build:** **medium.**

**4.2 Policy / golden-path recommendation (revenue tier)**
- **Job:** "recommend only within our allowlist / license policy / min-confidence."
- **Why:** individual devs won't pay for a recommender; a platform team enforcing dependency standards will. Monetization without leaving the identity.
- **Build:** **medium**; high ARR leverage.

---

## 4. Out of scope (would dilute identity or duplicate incumbents)

- ❌ **Full security / vuln scanning** → Snyk/Socket's job. Keep `verify` lightweight (slopsquat + real/healthy check) as the install wedge; do not expand into SCA.
- ❌ **Full API documentation serving** → Context7/GitMCP. Integrate as optional enrichment; do not rebuild.
- ❌ **System-structure design** (monolith vs microservices, topology, module boundaries) → stays a non-goal. lurq has no objective signal for system-design judgment; its evidence base is package health + compatibility, not architectural fitness. Deferred to Phase 3 (§6), and only if outcome data can ground it.
- ✅ **Stack composition from intent** (intent-doc → role-decomposed, version-compatible *package set*) is **in scope** and is the refined boundary that replaces the old "slot-by-slot only" framing: lurq composes the *stack* (which packages, which versions, by role); the agent/human composes the *system*. This is Tier 4.1 extended by an intent-doc front end — sets-that-work-together, never a full system assembler. See §6.

---

## 5. The shape of the product

Tiers 1–3 are one coherent loop: **recommend the right library → show how to wire it → tell you when it's dead and what replaces it → know which libraries agents actually succeed with → quietly accumulate the proprietary outcome signal underneath.** That progression is what converts lurq from a copyable recommender into the necessary, compounding layer in the agent dependency-selection loop.

**Sequencing logic:** ship 1.1 + `verify` first (cheap, drives install + call volume) → instrument 3.1 from day one (cheap to capture, compounds) → build 2.1 once there's call volume to justify the eval infra → layer 1.2/1.3 and 4.1 as the graph matures → 4.2 when there's a team buyer asking.

---

## 6. Build phasing — intent-doc → stack composition (decided)

This captures the direction agreed in design discussion: lurq grows from a single-slot recommender into an **intent-driven stack composer**, without becoming an architecture oracle. The mechanism: read a *project brief* (a `README.md` / spec / `.md` / `.txt` describing what the user wants to build — **intent, not source code**), decompose it into capability roles, recommend a package per role from the existing engine, run the compatibility engine across the set, and render the result (the narrowed `diagram` tool becomes the visualizer).

**Why this stays on-identity:** a project brief is just a richer `need`; reading intent docs is not reading source, so it preserves "lurq never sees the user's code" and does not duplicate the calling agent (which holds the *code* context, not the *requirements*). lurq composes the **stack**; the agent/human composes the **system**. That line is the whole discipline.

**Honesty discipline (carried from the diagram work):** a composed stack is a **reference starter stack**, labeled partial/not-authoritative, with per-slot confidence — never presented as "your architecture, solved."

### Phase 1 — JS/TS stack composition (now)
- **Ecosystem:** npm only (stays inside the v1 hard scope; "make JS/TS excellent first").
- **Domains:** frontend, backend, and **LLM-integration** (npm-native, fastest-churning, most startup-dense — the showcase for lurq's freshness wedge against training-cutoff bias).
- **Flow:** intent-doc → role extraction → per-role `recommend` → compatibility check → rendered stack. Built on the **existing health substrate** (health scoring is v1's floor, not a future feature).
- **Depends on:** Tier 4.1 (compatibility/version engine) — the next major build; defensible because "which versions ship together" is accumulated data, not a public-API wrapper.

### Phase 2 — PyPI / Python data analysis (deliberate ecosystem expansion)
- **What:** "analysis" = general **data analysis**, which is Python → PyPI. This is the first proof the engine generalizes beyond npm (promotes §20.2 of the master spec from "someday" to "next ecosystem").
- **Why gated separately:** a second registry with different metadata and scoring shape (bundle-size/efficiency is meaningless for Python). Folding it into Phase 1 would contradict "JS/TS first," so it is its own phase.
- **Foundation already present:** the `packages.ecosystem` column exists, the scoring model already redistributes weight when `efficiency` is `null`, and deps.dev already covers PyPI (Scorecard + advisories generalize). Work to add: a PyPI registry source + a Python download-stats source.

### Phase 3 — depth: performance, wireability, technical architecture (later)
- **Performance / agent-wireability** (Tier 2.1): runtime/efficiency signals and "can a model actually produce working code with this," kept separate from health.
- **Technical architecture / system-structure design:** the oracle-adjacent layer — only attempted once outcome data (3.1) can ground it, and still subject to the §4 non-goal until then.
