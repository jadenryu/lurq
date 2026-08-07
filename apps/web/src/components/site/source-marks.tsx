/**
 * One glyph per upstream source, drawn rather than fetched.
 *
 * WHY NOT THE REAL LOGOS. Two reasons, and the second is the deciding one.
 *
 * 1. The reference block hotlinked its icons off images.shadcnspace.com. Putting
 *    someone else's CDN on the critical path of the homepage means the ring goes
 *    blank the day they rotate the bucket, and it hands them a log line for
 *    every visitor we have.
 *
 * 2. There is no coherent set to fetch. npm and GitHub have marks everyone
 *    knows; deps.dev, OSV, Bundlephobia and the OpenSSF Scorecard do not have a
 *    mark a developer would recognise at 20px. A ring of two famous logos and
 *    eight unfamiliar ones reads as two sources and some noise, and reproducing
 *    the octocat from memory produces a mangled octocat.
 *
 * So: one drawn set, in the page's own language. Each glyph says what the source
 * *contributes* rather than who publishes it, which is the useful half anyway:
 * a reader scanning the ring learns that one of these is a bar chart of
 * downloads and one is a dependency tree.
 *
 * RULES, inherited from capability-figures.tsx.
 *   · No two share a silhouette. A set where six are "a rounded square with
 *     something inside" is one icon drawn six times.
 *   · No verdict colour. tokens.css reserves --held and --conflict for things
 *     that actually passed or failed; a decorative glyph is neither. Everything
 *     here is currentColor, so the badge sets the value.
 *   · 24x24, 1.5 stroke, round caps, geometry on the half-pixel grid so a 20px
 *     render stays crisp.
 *
 * These are keyed by host in content/provenance.ts. A source with no glyph falls
 * back to `Dot`, so a new entry in the pipeline renders plainly instead of
 * throwing.
 */

type MarkProps = { className?: string; style?: React.CSSProperties };

/** Shared frame. Every glyph is stroked, none are filled, so this sets both. */
function Mark({ className, style, children }: MarkProps & { children: React.ReactNode }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      className={className}
      style={style}
    >
      {children}
    </svg>
  );
}

/** npm registry: an isometric box. The package itself, and what it declares. */
function Cube(p: MarkProps) {
  return (
    <Mark {...p}>
      <path d="M12 3 20.5 7.5v9L12 21 3.5 16.5v-9L12 3Z" />
      <path d="M3.5 7.5 12 12l8.5-4.5M12 12v9" />
    </Mark>
  );
}

/** npm downloads: weekly volume and the 90-day trend, as a chart. */
function Bars(p: MarkProps) {
  return (
    <Mark {...p}>
      <path d="M3.5 20.5h17" />
      <path d="M6.5 20.5v-5M11 20.5v-9M15.5 20.5v-4M20 20.5v-12" />
    </Mark>
  );
}

/** npm search: discovery candidates, so a lens rather than a list. */
function Lens(p: MarkProps) {
  return (
    <Mark {...p}>
      <circle cx="10.5" cy="10.5" r="6.5" />
      <path d="m15.5 15.5 5 5" />
    </Mark>
  );
}

/**
 * GitHub API: release cadence and activity, as a commit graph with a branch.
 * Four nodes and two rails was the first draft and it turned to soup at 20px;
 * one rail, one node, one branch is the least that still reads as history.
 */
function Commits(p: MarkProps) {
  return (
    <Mark {...p}>
      <path d="M4 17h15" />
      <path d="M8.5 15.2V11.5a2.5 2.5 0 0 1 2.5-2.5h3" />
      <circle cx="8.5" cy="17" r="1.9" />
      <circle cx="16" cy="9" r="1.9" />
    </Mark>
  );
}

/** GitHub raw: the README, fetched as text. */
function Page(p: MarkProps) {
  return (
    <Mark {...p}>
      <path d="M5.5 3.5h9l4.5 4.5v12a1 1 0 0 1-1 1h-12a1 1 0 0 1-1-1v-15a1 1 0 0 1 1-1Z" />
      <path d="M14 3.5V8h4.5" />
      <path d="M8.5 12.5h7M8.5 16h4.5" />
    </Mark>
  );
}

/** deps.dev: the dependency graph, one node fanning out. */
function Tree(p: MarkProps) {
  return (
    <Mark {...p}>
      <circle cx="12" cy="4.5" r="2" />
      <circle cx="6" cy="19.5" r="2" />
      <circle cx="18" cy="19.5" r="2" />
      <path d="M12 6.5v4.5M12 11h-6v6.5M12 11h6v6.5" />
    </Mark>
  );
}

/** OpenSSF Scorecard: a card of checks. Deliberately not a shield: the whole
    point of the Scorecard is that it is itemised, and a shield says "secure",
    which is a verdict this page has not earned. */
function Scorecard(p: MarkProps) {
  return (
    <Mark {...p}>
      <rect x="3.5" y="4.5" width="17" height="15" rx="1.5" />
      <path d="m6.5 9 1.5 1.5L11 7.5M6.5 15l1.5 1.5L11 13.5" />
      <path d="M13.5 9.5h4.5M13.5 15.5h4.5" />
    </Mark>
  );
}

/**
 * OSV advisories: a diamond notice. A broken timeline was the first attempt and
 * it read as a stray bracket at badge size. Not a shield: a shield says "secure",
 * which is a verdict, and this is the source that reports the opposite anyway.
 * Nothing else in the set is a diamond, so the silhouette stays unique.
 */
function Advisory(p: MarkProps) {
  return (
    <Mark {...p}>
      <path d="M12 3.5 20.5 12 12 20.5 3.5 12 12 3.5Z" />
      <path d="M12 8.5v4M12 15.5v.01" />
    </Mark>
  );
}

/** Bundlephobia: install cost, as a caliper measuring a width. */
function Caliper(p: MarkProps) {
  return (
    <Mark {...p}>
      <path d="M4 6.5v11M20 6.5v11" />
      <path d="M7 12h10" />
      <path d="m9.5 9.5-2.5 2.5 2.5 2.5M14.5 9.5l2.5 2.5-2.5 2.5" />
    </Mark>
  );
}

/** jsDelivr: the shipped .d.ts, so braces around a signature. */
function Types(p: MarkProps) {
  return (
    <Mark {...p}>
      <path d="M9 4.5c-2.5 0-2.5 6-2.5 6S6.5 12 4.5 12c2 0 2 1.5 2 1.5s0 6 2.5 6" />
      <path d="M15 4.5c2.5 0 2.5 6 2.5 6s0 1.5 2 1.5c-2 0-2 1.5-2 1.5s0 6-2.5 6" />
      <path d="M11 12h2" />
    </Mark>
  );
}

/** Fallback for a source the pipeline adds before anyone draws it a glyph. */
function Dot(p: MarkProps) {
  return (
    <Mark {...p}>
      <circle cx="12" cy="12" r="7" />
      <circle cx="12" cy="12" r="2" />
    </Mark>
  );
}

/**
 * Keyed by host, not by name: the host is the stable identifier in
 * provenance.json, and three of these differ only by path.
 */
const SOURCE_MARKS: Record<string, (p: MarkProps) => React.ReactElement> = {
  "registry.npmjs.org": Cube,
  "api.npmjs.org": Bars,
  "registry.npmjs.org/-/v1/search": Lens,
  "api.github.com": Commits,
  "raw.githubusercontent.com": Page,
  "api.deps.dev": Tree,
  "api.deps.dev/v3/projects": Scorecard,
  "api.deps.dev/v3/advisories": Advisory,
  "bundlephobia.com": Caliper,
  "cdn.jsdelivr.net": Types,
};

export const markFor = (host: string) => SOURCE_MARKS[host] ?? Dot;

/**
 * Colour. Seven hues, saturated on purpose.
 *
 * The first pass used --tile-1..6 straight, which tokens.css set aside as
 * "decorative identity, never a verdict" and left unused. Right palette, wrong
 * strength: those values are muted for a light-ish panel and on --ground
 * (#08080a) they go to mud. This is the one section on the page that is allowed
 * to be playful, so the tile hues are kept as the anchor and lifted in oklch
 * until they actually read. Same family, enough chroma to be a colour.
 *
 * Written in oklch so lightness and chroma are set directly and the seven land
 * at matching weight; the same hues in hex drift in perceived brightness and the
 * ring ends up with two marks that shout and five that mumble.
 *
 * ONE RULE KEPT. tokens.css reserves --held and --conflict as verdicts and
 * nothing else. None of these is either token, and the two that come closest are
 * pushed off those hues deliberately: npm sits at 20 against --conflict's ~40,
 * and the Scorecard green at 158 is a colder teal than --held. In a ring of
 * seven, no single hue reads as a pass or a fail anyway; it reads as a key.
 *
 * GROUPED BY PROVIDER, not one hue per source. Three red marks on the ring are
 * the three npm endpoints and both violets are GitHub, so the colour carries
 * something instead of just being ten colours.
 */
const NPM = "oklch(0.68 0.19 20)"; /* crimson */
const GITHUB = "oklch(0.71 0.16 295)"; /* violet */
const DEPS = "oklch(0.71 0.16 248)"; /* blue */
const SCORECARD = "oklch(0.75 0.15 158)"; /* teal-green */
const OSV = "oklch(0.79 0.16 72)"; /* amber */
const BUNDLE = "oklch(0.77 0.13 200)"; /* cyan */
const JSDELIVR = "oklch(0.73 0.17 340)"; /* magenta */

const TINTS: Record<string, string> = {
  "registry.npmjs.org": NPM,
  "api.npmjs.org": NPM,
  "registry.npmjs.org/-/v1/search": NPM,
  "api.github.com": GITHUB,
  "raw.githubusercontent.com": GITHUB,
  "api.deps.dev": DEPS,
  "api.deps.dev/v3/projects": SCORECARD,
  "api.deps.dev/v3/advisories": OSV,
  "bundlephobia.com": BUNDLE,
  "cdn.jsdelivr.net": JSDELIVR,
};

/** Falls back to muted ink, so an unmapped source is plain rather than garish. */
export const tintFor = (host: string) => TINTS[host] ?? "var(--ink-3)";

/**
 * What the globe is speckled with, so the sphere and the ring around it are
 * visibly the same palette rather than two colour schemes stacked.
 *
 * Blue and violet lead because they are the two that survive being a 2px dot at
 * 30% alpha; crimson and teal are the seasoning. White stays the majority: the
 * reference cloud is mostly white with a blue shimmer, and a sphere that is
 * evenly seven colours reads as static, not as a globe.
 */
export const GLOBE_TINTS = [DEPS, GITHUB, NPM, SCORECARD] as const;
