# Build spec 01 — nav + hero (v3, replaces v2)

Replaces v2 entirely. Three things from v2 get deleted outright — see §0.

**In scope:** tokens, the background system, nav, hero, the check panel, the IDE strip.
**Out of scope:** the compat matrix, the footer body, every other section. Leave an empty
`<section id="fig-01" />` after the IDE strip.

---

## 0 · Delete first

1. `components/site/graph-field.tsx` and `content/graph-field.json`. The graph
   background reads as random constellation lines, not a dependency graph. Gone.
2. The terminal panel. Replaced by the check panel in §6.
3. The four-clause lead paragraph. Replaced in §5.

---

## 1 · What's wrong with the current build

Not the content — the rhythm. Folio gets from nav to product panel in ~900px. Ours takes
~1,400px for less material. Every gap is 30–40% too large, the headline wraps to three
lines when it should be two, and the lead runs four lines when it should run two.

This spec is mostly a tightening pass plus two replacements. Specific spacing values are
given in §5 and they are not suggestions — the compactness *is* the fix.

---

## 2 · Tokens

Add to `app/styles/tokens.css`. Everything else from v2 stands.

```css
:root {
  /* v2 tokens unchanged: --ground --surface --surface-2 --edge --edge-lit
     --ink --ink-2 --ink-3 --held --conflict --declared --mark            */

  /* package tile palette — deterministic per package name, decorative only.
     These are NOT verdicts and must never be used for one. */
  --tile-1: #4a6fa5;
  --tile-2: #7a5c9e;
  --tile-3: #a66a3f;
  --tile-4: #3f7a6b;
  --tile-5: #96524e;
  --tile-6: #5a6b8c;
}
```

Fix the `--ink-3` typo from v2 if it's still there.

---

## 3 · Background system

Copy the uploaded image to `public/hero-field.jpg`. **Compress it first** — target under
400KB at 2560px wide, and serve it through `next/image` with `priority` on the hero
instance.

One component, `components/site/atmosphere.tsx`, taking a `variant` prop of
`"hero" | "footer"`. Three stacked absolutely-positioned layers, `pointer-events: none`:

**Layer 1 — the photo.**

```css
background-image: url(/hero-field.jpg);
background-size: cover;
background-position: center 35%;
filter: grayscale(0.45) saturate(0.75) brightness(0.42);
```

**Layer 2 — the black gradient.** This is what makes it read as atmosphere instead of
wallpaper.

Hero variant:

```css
background: linear-gradient(
  to bottom,
  rgba(8, 8, 10, 0.98) 0%,
  rgba(8, 8, 10, 0.97) 38%,
  rgba(8, 8, 10, 0.86) 72%,
  rgba(8, 8, 10, 0.93) 100%
);
```

The photo is only perceptible as a warm haze across the lower third. No flower should be
identifiable. If you can tell it's a meadow, the overlay is too weak.

Footer variant:

```css
background: linear-gradient(
  to bottom,
  rgba(8, 8, 10, 1) 0%,
  rgba(8, 8, 10, 0.88) 30%,
  rgba(8, 8, 10, 0.72) 100%
);
```

Here it reads as an image, the way Folio's does.

**Layer 3 — grain.** Inline SVG `feTurbulence`, `baseFrequency` .8, `opacity: .03`,
`mix-blend-mode: overlay`. Static. Never animated.

Build the footer variant now even though the footer body isn't in scope — mount it in an
empty `<footer>` so the treatment is done and the next spec only adds content.

---

## 4 · Nav

```
lurq •     Docs   Changelog   GitHub ↗          Sign in    [ Get started ]
```

Two states. Everything between them transitions together over 280ms `--ease`.

**AT REST (scrollY < 80)**

- full width, background transparent, no border, no shadow
- inner container max-width 1180px, height 68px
- both Sign in and Get started visible

**CONDENSED (scrollY >= 80)**

- inner container max-width 860px, height 56px
- `position: fixed`, `top: 10px`, `border-radius: 16px`
- background `rgba(16,16,19,.94)`, 1px `--edge` border
- `box-shadow 0 8px 28px rgba(0,0,0,.45)`
- Sign in fades out and unmounts from flow — width 0, opacity 0, margin 0, over the same
  280ms

Transition `max-width`, `height`, `top`, `border-radius`, `background-color`,
`border-color`, `box-shadow`. All GPU-cheap. Add `will-change: max-width` only while the
transition is running, then remove it.

No `backdrop-filter`. The .94 background is opaque enough that page content passes behind
it cleanly.

**Hysteresis:** enter condensed at 80px, exit at 60px. Without the 20px gap the nav
flickers when someone rests their scroll near the threshold.

**Below 720px:** never condense. The nav stays full-width and Sign in stays visible. A
pill at 375px is a pill that touches both edges.

**Status dot** — unchanged. Three states, `/healthz` every 30s, one pulse per successful
poll, `--declared` before first response, `--conflict` on failure. Never fake it.

---

## 5 · Hero — compact

`max-width: 1080px`, centred. **These spacing values replace whatever is there now.**

| From        | To          | Gap  |
| ----------- | ----------- | ---- |
| nav bottom  | eyebrow     | 76px |
| eyebrow     | headline    | 26px |
| headline    | lead        | 22px |
| lead        | CTAs        | 30px |
| CTAs        | note line   | 14px |
| note line   | check panel | 52px |

Corner registration marks: keep, 13px, `--edge`, inset 24px, hidden below 620px.

### Eyebrow

Unchanged from v2. Mono 11px, `--ink-3`, hairline rules either side.
`v0.0.6 · live on npm ↗ · MIT`, with `live on npm ↗` linking to
`https://www.npmjs.com/package/lurqrun`.

### Headline — two lines, forced

`max-width: 980px` on the h1 so it has room. Size `clamp(2.2rem, 5vw, 3.4rem)`,
`line-height: 1.06`, `letter-spacing: -.03em`.

Two `<span style="display:block">` children, hard-broken. Do not rely on
`text-wrap: balance` to find the break — set it explicitly:

```
The verification layer
for everything your agent installs.
```

Below 900px the second line may wrap to two; that's fine. Above it, three lines is a bug.

### Lead — two lines

`--ink-2`, `max-width: 60ch`, `clamp(15px, 1.5vw, 16.5px)`, `line-height: 1.6`.

```
An MCP server your agent calls before it installs — so the packages are real,
the versions agree, and the stack runs where you deploy.
```

23 words. Do not add clauses to it.

### CTAs

Unchanged from v2. Primary is the copyable `npx lurqrun` in mono with a copy glyph;
secondary is `Read the docs`.

### Note line

This is where the honesty moved to. Mono 12px, `--ink-3`, centred:

```
Three of the four checks work today. See what doesn't ↓
```

Links to `#limits`, hover `--mark`. It's small and it's above the fold — which is the
whole point. A claim the size of the headline needs its qualifier visible without
scrolling, not buried at 3,000px.

---

## 6 · The check panel

Replaces the terminal. Same slot: centred, **`max-width: 720px`**, overlapping the bottom
of the hero section by 100px so it breaks into the ground below.

Reads `content/hero-run.json` from the real `lurq compat` call. Build fails without it.

Shell: `--surface`, 12px radius, 1px `--edge`, 1px `--edge-lit` top border only, shadow
`0 28px 70px rgba(0,0,0,.6)`. **No mac window dots** — that's the cliché we're getting
away from.

### Header strip

`--surface-2`, 44px, 1px `--edge` bottom border.

- Left: the lurq mark at 14px, then `compat` in mono 12px `--ink-2`.
- Right: `5 packages · 10 pairs` in mono 11px `--ink-3`, then a `2 conflicts` chip in
  `--conflict` — outlined, not filled, 11px.

### Package rows

One row per package, 52px tall, 1px `--edge` dividers, 16px horizontal padding.

- **Tile.** 28px rounded square, 6px radius, background from `--tile-*` chosen by a
  deterministic hash of the package name. First letter of the package in white, 13px,
  600 weight. `@scoped/name` uses the letter after the slash.
- **Name.** Mono 13px `--ink`. Version in `--ink-3` immediately after.
- **Right side.** Status chip, 11px, 4px radius, outlined:
  - held → `--held` border and text, with a 9px check glyph
  - conflict → `--conflict` border and text, with a 9px `×` glyph

### Conflict detail

Each conflicting row expands to a sub-row beneath it: `--surface-2` background, 12px mono
`--ink-2`, indented 60px to align under the name, with a 2px `--conflict` left border.

```
needs peer @auth/core@0.34.3 — stack resolves 0.41.3
```

Only conflicts expand. Held rows stay collapsed.

### Footer strip

Mono 11px `--ink-3`, 36px tall, `--edge` top border:

`checked {generatedAt} · read at request time`

Render `generatedAt` from the JSON. Never hardcode the date.

---

## 7 · IDE strip

Replaces the "trusted by leading teams" slot. Directly below the check panel's overhang,
72px of clearance above and below.

Centred label in mono 11px `--ink-3`, `letter-spacing: .1em`:

```
Installs into
```

Then five marks in a row, 44px gaps: Claude Code, Cursor, Windsurf, Copilot, Codex.
Monochrome SVG at `--ink` 32% opacity, 20px tall, hover to 70% over 120ms.

This is a compatibility claim, not a customer claim. Do not add a company logo, a count,
or the word "trusted".

---

## 8 · Motion

| t      | element                                                                                                                      |
| ------ | ---------------------------------------------------------------------------------------------------------------------------- |
| 0ms    | nav                                                                                                                          |
| 200ms  | eyebrow                                                                                                                      |
| 320ms  | headline line 1                                                                                                              |
| 430ms  | headline line 2                                                                                                              |
| 600ms  | lead                                                                                                                         |
| 730ms  | CTAs                                                                                                                         |
| 830ms  | note line                                                                                                                    |
| 950ms  | check panel rises 24px, fades in                                                                                             |
| 1300ms | package rows stagger in, 60ms apart                                                                                          |
| 1650ms | scan: a 2px `--mark` line at 30% opacity travels top to bottom of the rows over 800ms. Each row's status chip resolves as the line passes it. |
| 2500ms | conflict sub-rows expand, height auto, 260ms each, 120ms apart                                                               |
| 2900ms | IDE strip                                                                                                                    |

Then everything stops. The status dot's heartbeat is the only remaining motion.

All reveals: `translateY(16px)` + opacity, 240ms, `--ease`. **No blur, no per-character
stagger, no loops.** `BlurFade` is fine as an `inView` wrapper with `blur={0}`.

`prefers-reduced-motion` → all final states at t=0, no scan, conflicts pre-expanded, dot
does not pulse, grain and photo still render.

---

## 9 · Forbidden

- `unbreakable`, `re-rank`, `context7` anywhere.
- `verified` applied to a result. The category is "verification layer"; a pair is `held`
  or `conflict`. Nothing has been sandbox-executed.
- `--tile-*` colours used for any status meaning. They're decorative identity only.
- Any number not read from `content/`.
- `backdrop-filter`, container blur, radial glows, coloured shadows, gradient text.
- Mac window dots on any panel.
- The words "trusted", "customers", "teams" in the IDE strip.
- `localStorage` / `sessionStorage`.

---

## 10 · Done when

```bash
grep -riE "unbreakable|re-rank|context7" components/ app/ content/   # empty
grep -ri "backdrop-filter" components/ app/                          # empty
ls components/site/graph-field.tsx                                   # no such file
```

- At 1440: headline is exactly two lines, lead is exactly two lines, and the top of the
  check panel is above 1000px from the top of the document.
- At 1440, the meadow is not identifiable as a meadow in the hero.
- Renders 375 / 768 / 1440 / 2560, no horizontal scroll. Below 768 the check panel goes
  full-bleed with 16px gutters and rows drop the version string.
- Tab order: wordmark → Docs → Changelog → GitHub → Sign in → Get started → npm link →
  install → Read the docs → note line. Visible `--mark` focus ring, 2px offset.
- Offline: dot `--conflict`, panel still renders from JSON.
- `hero-field.jpg` under 400KB. LCP under 2.0s on desktop.
- Lighthouse a11y ≥ 95, performance ≥ 90.
