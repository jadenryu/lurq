# lurq landing page — design revamp brief

Paste this into a new chat to restart the landing redesign with full context.

---

## Product (one sentence)

**lurq** is a live, evidence-scored **package index for coding agents** (MCP / CLI / API / skill). It helps agents recommend libraries that actually exist, ship, and stay maintained, and catch peer conflicts, deprecations, engine mismatches, and security traps **before install**.

Not a general coding agent. Not a vector DB. The job: **fresh registry-grounded package knowledge + preflight failure detection**.

---

## Why this revamp exists

The current `feat/landing-page` work got directionally right (terminal identity, interactive demo, bakeoff honesty) but **visually failed**:

1. **Too black.** Pitch / near-black everywhere reads as “cheap dark mode” or “we’re hiding something,” not premium / serious. Investors and users read trust from surface hierarchy (lifted cards, hairlines, soft light), not from pure void.
2. **Decorative backdrops looked bad.** A “package constellation” SVG behind the hero was tried and rejected. Do **not** bring it back. Prefer quiet atmosphere (soft radial light, faint grid) or a real product visual, not abstract node graphs.
3. **Benchmark swung between “too honest / sparse” and “too noisy.”** Need one strong chart story with **dummy numbers for now** (clearly labeled illustrative), replaceable later with bakeoff data.
4. **Wow factor was confused with motion.** Entrance animations and living graphs did not create trust. What creates trust: clear product definition, install path, interactive demo of the actual job, and believable proof.

Reference aesthetic (inspiration, not clone): **[trynia.ai](https://www.trynia.ai/)** — monochrome, monospace, bordered panels, Key Metrics strip + chart, Install / Try Demo product panel. Steal the *seriousness*, not the brand.

---

## Brand & visual direction (non-negotiables)

### Do

- **Monochrome-first** site chrome (greyscale tokens). Terminals may use **soft syntax colors** (prompt blue, ok green, bad coral, accent violet) *inside* product mocks only.
- **Lifted surfaces:** background should feel charcoal / deep grey, not `#000`. Cards slightly lighter; hairline borders; soft top light.
- **Typography:** Commit Mono (or similar) for headings + mono UI; Geist (or similar) for body. Lowercase marketing headlines are fine if intentional.
- **Terminal-native identity:** numbered section labels (`[ 02 ] benchmark`), mono eyebrows, install command as a first-class UI.
- **Product IS the hero:** Live demo + Install tabs (no sparkle / “AI” icons).
- **Compact first viewport:** hero + CTAs + product panel should largely fit one desktop screen.
- **Free messaging:** “free while in pre-alpha” is a real product signal.
- **No em dashes (—)** in user-facing copy. Use commas, periods, or middots (`·`).

### Don’t

- Purple-on-black “AI startup” glow themes.
- Pitch-black full-bleed voids with no surface hierarchy.
- Sparkle / magic / robot icons that read AI-generated.
- Giant dual “100%” recall/precision hero numbers (looks fake even when true). Prefer qualitative + one clear lift, or charts with methodology.
- Decorative package graphs / constellation backgrounds.
- Overlong scroll-pinned hero gimmicks (200vh sticky was tried and removed for good reason).
- Dense methodology walls next to every chart. One footnote is enough.

---

## Page structure (current / keep unless redesigning IA)

On `apps/web` marketing home roughly:

1. Announcement bar (pre-alpha / bakeoff teaser)
2. Navbar
3. **Hero** — product definition + CTAs + Live demo / Install panel
4. IDE marquee (“works inside your coding agent”)
5. Roadmap / plan visual (optional; currently sparse)
6. Comparison carousel (without lurq vs with lurq terminals)
7. **Benchmark** — Key Metrics + charts (illustrative for now)
8. How it works (MCP / CLI / API / Skill / Index / Search / Cache)
9. Capabilities / prowess terminal
10. Changelog
11. FAQ
12. CTA (“try lurq now (psssst: it's free!)”)
13. Footer

Branch: **`feat/landing-page`** (cut from `origin/main`, separate from `feat/bakeoff-harness`).

Dev: from repo root → `npm run dev --workspace @lurq/web` → `http://localhost:3000`

---

## Hero requirements (serious, not decorative)

What “serious” means for investors:

- One **definitional** H1: e.g. `the package index for coding agents.`
- One concrete sub: MCP + catch peer / deprecation / security traps before install.
- Dual CTAs: `get started free` + link to bakeoff / product.
- Product panel tabs: **Live demo** | **Install** (text only, no icons).
- Live demo: visitor picks a need → model alone fails → + lurq resolves with score. Keep it **sparse** (no evidence bar spam). Scenarios live in `apps/web/src/content/hero-scenarios.ts`.
- Install: cryptic / redacted `npx lurqrun …` until launch (`CrypticInstall`).
- Backdrop: **quiet only** (radial lift + faint grid). No constellation.

---

## Benchmark requirements (dummy OK for now)

**Goal:** one strong, Nia-style proof section. Charts must look like the trynia.ai benchmark (vertical bars + Key Metrics + methodology), **not** horizontal list bars or dense tables.

### Reference layout (match this structure)

From Nia’s benchmark section:

1. **Section title** `BENCHMARK` + short thesis paragraph.
2. **Key Metrics** bordered strip with 3 big numbers in columns, e.g.:
   - `#1` Lowest error rate…
   - `43.4%` Fewer errors than…
   - `11.3%` Ahead of next best…
3. **Main panel (left ~60%):** vertical bar chart
   - Title like `Hallucination Score · Bleeding-Edge APIs` (for lurq: e.g. `Bad-stack rate · registry-grounded suite`)
   - Y-axis 0–100%
   - **Lead series = solid white bar** (lurq / Claude + lurq), value label floating on top
   - Competitors / baselines = **dim grey bars**, ascending or clearly worse
   - Mono labels under each bar
   - Optional small legend under chart for the lead series
4. **Side panel (right ~40%):** Methodology
   - Short bullets (suite focus, models, judge, eval constraint)
   - Error / failure category chips as mono pills, e.g. `peer_conflict`, `deprecated`, `nonexistent_pkg`
5. Mark data **illustrative** until real bakeoff numbers are swapped in.

### Chart type rules

- Prefer **vertical column chart** (Nia style). Do **not** use horizontal progress-list charts as the hero proof.
- Lower-is-better for bad-stack / error / hallucination rates (lurq bar shortest + brightest).
- Optional second chart later for install resolve (higher-is-better); keep the first viewport of the section focused on one chart + methodology.
- Animate bars growing from the baseline on scroll-in; respect `prefers-reduced-motion`.

### Story for dummy data (directionally honest)

1. Failure detection / bad-stack catching is the strongest claim.
2. Stack selection: with lurq, agents resolve more installable stacks; Claude lifts most.
3. Biggest value: catch peer / engine / deprecated bombs, not “prettier stacks always.”

Data file: `apps/web/src/content/benchmark.ts`  
Section: `apps/web/src/components/sections/section-benchmark.tsx`

When real numbers arrive, only swap content constants; keep the chart chrome.

---

## Real bakeoff findings (for honesty when publishing)

Internal findings (summarized):

- **Failure detection:** lurq preflight matched fixture labels at **100% recall and 100% precision** on the labeled suite (strongest claim; present carefully).
- **Stack selection (example run):** with-lurq setups hit **100% install resolve**; Claude **92% → 100%** clearest lift; GPT/Gemini often already near ceiling alone; coinstall can be mixed (GPT + lurq not always better than GPT alone).
- Real peer trap example: React 19 + `@react-spring/web@9` (fails) → `@10` (works).

Until published: use dummy/illustrative charts that show the **same direction** of the story, clearly labeled.

---

## Theme tokens (current problem)

Dark theme currently lives in `apps/web/src/app/globals.css` under `.dark`.

Problem: background pushed too close to black (`oklch ~0.11–0.15`). Revamp should:

- Raise `--background` into a **rich charcoal** with slight warmth or cool tint (still near-mono).
- Raise `--card` / `--secondary` so panels have clear elevation.
- Keep chroma ~0 for brand tokens if staying monochrome; white CTAs.
- Soft syntax colors only inside terminal mocks.

---

## Key files

| Area | Path |
|------|------|
| Home composition | `apps/web/src/app/(marketing)/page.tsx` |
| Global theme | `apps/web/src/app/globals.css` |
| Hero | `apps/web/src/components/sections/hero.tsx` |
| Live demo | `apps/web/src/components/visuals/hero-live-demo.tsx` |
| Demo scenarios | `apps/web/src/content/hero-scenarios.ts` |
| Benchmark UI | `apps/web/src/components/sections/section-benchmark.tsx` |
| Benchmark data | `apps/web/src/content/benchmark.ts` |
| Comparison | `apps/web/src/components/sections/section-comparison.tsx` |
| Showcase | `apps/web/src/components/sections/section-showcase.tsx` |
| Media manifest | `apps/web/src/content/media.ts` |

---

## Success criteria for the revamp

- [ ] First viewport does not look like empty black; surfaces have hierarchy and soft light.
- [ ] Hero reads “serious product company” in 3 seconds (definition + demo + free).
- [ ] No AI-tell icons; no constellation backdrop.
- [ ] Benchmark matches **Nia-style vertical bar chart** + Key Metrics + methodology panel (dummy OK, labeled illustrative). Not horizontal list bars.
- [ ] Terminals have restrained color; page chrome stays mono.
- [ ] Compact enough that the hero story is visible without hunting.
- [ ] Copy has **no em dashes**.
- [ ] Feels unique to lurq (package index for agents), not a generic AI landing page and not a Nia clone.

---

## Explicit ask for the next agent

1. Revamp the **overall light/atmosphere** of the marketing site (too black → trustworthy charcoal monochrome with lifted cards).
2. Keep product story and interactive demo; improve craft.
3. Make **benchmark charts** look excellent with illustrative dummy data; wire so real numbers drop into `content/benchmark.ts` later.
4. Do **not** reintroduce the package-graph hero backdrop.
5. Prefer one composition and restraint over more motion or more widgets.
