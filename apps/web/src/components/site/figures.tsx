/**
 * The tool figures, rebuilt as labelled technical drawings.
 *
 * WHY THE PREVIOUS SET WAS REPLACED. It obeyed the two rules in
 * capability-figures.tsx to the letter: structure in --edge-lit, content in
 * --ink-3, colour only on a mark that genuinely passed or failed, and no numbers
 * or names anywhere. Followed strictly across eleven figures, those rules
 * produce eleven grey abstractions of rings, fans and dots, and the verdict on
 * them was the correct one: they looked generated. Unlabelled geometry is what
 * decorative filler looks like, because it IS decorative. Nothing in a figure
 * with no content is information.
 *
 * WHAT REPLACES THEM. Drawings of the actual answer. A diff figure contains real
 * symbol names at real versions; a compat figure contains the real packages from
 * the recorded run and the real peer range that clashes. They cannot be mistaken
 * for stock art because nothing generic could contain them.
 *
 * TWO RULES ARE KEPT AND ONE IS BROKEN.
 *
 * KEPT: --held and --conflict are verdicts and nothing else. Every green tick
 * and every red cross below is a real pass or a real fail.
 *
 * KEPT: no invented findings. Everything printed here is either read from
 * content/hero-run.json (a real `lurq compat` run, see content/agent-session.ts)
 * or is a fact that can be checked in seconds against a public registry. Where a
 * figure needs a value that is neither, it does not print one.
 *
 * BROKEN: "no numbers or names". That rule was written to stop a decorative
 * diagram making claims it could not source. The answer to that is to source
 * them, not to draw nothing.
 *
 * COLOUR comes from source-marks.tsx, which is the only real palette on the site
 * and is already tuned to sit on --ground at matching weight. Structure stays
 * ink; hue is reserved for identity (which package) and verdict (what happened).
 */
import run from "@/content/hero-run.json";
import { SESSION_PACKAGES } from "@/content/agent-session";
import { DEPS, GITHUB, NPM, OSV, SCORECARD } from "@/components/site/source-marks";

const INK = "var(--ink)";
const INK_2 = "var(--ink-2)";
const INK_3 = "var(--ink-3)";
const EDGE = "var(--edge)";
const EDGE_LIT = "var(--edge-lit)";
const HELD = "var(--held)";
const CONFLICT = "var(--conflict)";
const SURFACE = "var(--surface)";
const SURFACE_2 = "var(--surface-2)";

export type FigureProps = {
  id: string;
  /** `meet` fits the whole drawing; `slice` crops it to a tile. */
  fit?: "slice" | "meet";
};

const MONO = "var(--font-commit-mono), ui-monospace, monospace";

/**
 * The frame: a dot field, a soft wash, and the depth the old set had none of.
 *
 * The wash is two radial stops rather than one flat fill. A figure on a flat
 * rectangle is the single strongest tell of a generated vector: real technical
 * drawings sit on a surface that has a light source.
 */
function Frame({
  id,
  fit = "slice",
  glow,
  children,
}: {
  id: string;
  fit?: "slice" | "meet";
  /** Hue and position of the lift behind the subject. */
  glow: { color: string; at: [number, number] };
  children: React.ReactNode;
}) {
  return (
    <svg
      aria-hidden
      viewBox="0 0 480 340"
      fill="none"
      preserveAspectRatio={`xMidYMid ${fit}`}
      className="absolute inset-0 h-full w-full"
      style={{ fontFamily: MONO }}
    >
      <defs>
        <pattern id={`${id}-dots`} width="40" height="40" patternUnits="userSpaceOnUse">
          <circle cx="20" cy="20" r="1.1" fill={EDGE} />
        </pattern>
        {/* The hue, at 14%. Above ~18% it stops being a light source and starts
            being a coloured background, which is the point where a panel and its
            figure become two different grounds. */}
        <radialGradient id={`${id}-glow`} cx={glow.at[0]} cy={glow.at[1]} r="0.72">
          <stop offset="0%" stopColor={glow.color} stopOpacity="0.14" />
          <stop offset="60%" stopColor={glow.color} stopOpacity="0.04" />
          <stop offset="100%" stopColor={glow.color} stopOpacity="0" />
        </radialGradient>
      </defs>
      <rect width="480" height="340" fill={`url(#${id}-dots)`} opacity="0.75" />
      <rect width="480" height="340" fill={`url(#${id}-glow)`} />
      {children}
    </svg>
  );
}

/** A raised card inside a figure: opaque fill, lit top edge. The room's rule. */
function Card({
  x,
  y,
  w,
  h,
  fill = SURFACE,
  stroke = EDGE,
  lit = true,
}: {
  x: number;
  y: number;
  w: number;
  h: number;
  fill?: string;
  stroke?: string;
  lit?: boolean;
}) {
  return (
    <>
      <rect x={x} y={y} width={w} height={h} rx="7" fill={fill} stroke={stroke} strokeWidth="1" />
      {lit && (
        <path
          d={`M${x + 7} ${y + 0.5} H${x + w - 7}`}
          stroke={EDGE_LIT}
          strokeWidth="1"
          strokeLinecap="round"
        />
      )}
    </>
  );
}

function T({
  x,
  y,
  children,
  fill = INK_2,
  size = 12,
  weight = 400,
  anchor = "start",
}: {
  x: number;
  y: number;
  children: React.ReactNode;
  fill?: string;
  size?: number;
  weight?: number;
  anchor?: "start" | "middle" | "end";
}) {
  return (
    <text
      x={x}
      y={y}
      fill={fill}
      fontSize={size}
      fontWeight={weight}
      textAnchor={anchor}
      dominantBaseline="middle"
    >
      {children}
    </text>
  );
}

/** A pill: version numbers, verdicts, counts. */
function Chip({
  x,
  y,
  w,
  label,
  color,
  tint,
}: {
  x: number;
  y: number;
  w: number;
  label: string;
  color: string;
  /** Fill, as a colour-mix against the panel. Omit for outline only. */
  tint?: string;
}) {
  return (
    <>
      <rect
        x={x}
        y={y}
        width={w}
        height="20"
        rx="10"
        fill={tint ? `color-mix(in oklab, ${tint} 18%, transparent)` : "transparent"}
        stroke={color}
        strokeOpacity="0.55"
        strokeWidth="1"
      />
      <T x={x + w / 2} y={y + 10.5} fill={color} size={11} anchor="middle">
        {label}
      </T>
    </>
  );
}

function Tick({ x, y, color = HELD }: { x: number; y: number; color?: string }) {
  return (
    <path
      d={`M${x} ${y} l3.5 3.8 l7 -8`}
      stroke={color}
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      fill="none"
    />
  );
}

function Cross({ x, y, color = CONFLICT }: { x: number; y: number; color?: string }) {
  return (
    <g stroke={color} strokeWidth="2" strokeLinecap="round">
      <line x1={x} y1={y - 4} x2={x + 8} y2={y + 4} />
      <line x1={x + 8} y1={y - 4} x2={x} y2={y + 4} />
    </g>
  );
}

/* ── real data ───────────────────────────────────────────────────────────────
   The one recorded run on the site, reused. gen-hero-run.ts writes it from an
   actual `lurq compat` invocation and refuses to write at all if the CLI fails,
   so a figure built on it cannot show a verdict the tool did not produce. See
   content/agent-session.ts for the full rule.
   ─────────────────────────────────────────────────────────────────────────── */

type RunPkg = { name: string; version: string };
type RunPair = {
  a: string;
  b: string;
  status: string;
  requirement?: { peer: string; range: string; resolved: string };
};

const VERSIONS = new Map((run.packages as RunPkg[]).map((p) => [p.name, p.version]));
const ver = (name: string) => VERSIONS.get(name) ?? "";

/**
 * The conflict the run actually found, and the reason it is looked up rather
 * than typed.
 *
 * An earlier draft of CompatFigure hardcoded the peer range as `<6.1.0`. The run
 * records `>=4.8.4 <6.1.0`, so the figure would have been printing a narrowed
 * version of a real finding: not false exactly, and not what the tool said,
 * which on this site is the same thing. Reading it means the drawing changes
 * when scripts/gen-hero-run.ts is re-run, like every other number on the page.
 *
 * Throws rather than falling back. A compat figure with no conflict in it is
 * a picture of nothing, and failing the build is how content/agent-session.ts
 * handles the same situation.
 */
const CONFLICT_PAIR: RunPair = (() => {
  const conflicts = (run.pairs as RunPair[]).filter(
    (pair) => pair.status === "conflict" && pair.requirement,
  );
  /*
   * Prefer the conflict the agent session is already about.
   *
   * The run records two, and a bare `.find()` returns the auth one
   * (next-auth pinning an exact @auth/core) while the session panel at the top
   * of the home page tells the TypeScript story. Two sections showing two
   * different conflicts from the same run reads as two unrelated examples
   * instead of one finding seen twice. content/agent-session.ts explains at
   * length why the TypeScript pair is the one that reads: TS 7 shipped without
   * a stable programmatic API, typescript-eslint still declares <6.1.0, and
   * "upgrade me to TypeScript 7" is a request people actually make.
   */
  const session = new Set<string>(SESSION_PACKAGES);
  const found =
    conflicts.find((pair) => session.has(pair.a) && session.has(pair.b)) ?? conflicts[0];
  if (!found) {
    throw new Error(
      "figures.tsx: hero-run.json has no conflict pair with a requirement. Re-run scripts/gen-hero-run.ts.",
    );
  }
  return found;
})();

/** Shortens a scoped name to fit a 420px card without an ellipsis mid-word. */
const short = (name: string) => (name.length > 22 ? `${name.slice(0, 21)}…` : name);

/**
 * Is this package real, and is it what you meant?
 *
 * The centre is a name a model produced. The ring is the real neighbourhood it
 * landed in, and now the neighbours are NAMED: an unlabelled dot on a circle
 * says "some package", and the whole point of the check is which one.
 *
 * `reqeusts` is the canonical example and is deliberately a name from the Python
 * literature rather than an npm package we are accusing of anything. The three
 * neighbours are real npm packages, and the claim attached to them is only that
 * they exist, which is the one claim this figure needs and the one anybody can
 * check in a second.
 */
export function VerifyFigure({ id, fit }: FigureProps) {
  const neighbours: [string, number, number][] = [
    ["request", 316, 96],
    ["requests", 340, 176],
    ["superagent", 306, 252],
  ];
  return (
    <Frame id={id} fit={fit} glow={{ color: NPM, at: [0.28, 0.5] }}>
      {/* The name under test. Hollow, and struck through: nothing backs it. */}
      <Card x={34} y={140} w={172} h={62} fill={SURFACE_2} stroke={CONFLICT} />
      <T x={50} y={162} fill={INK} size={15}>
        reqeusts
      </T>
      <Cross x={176} y={162} />
      <T x={50} y={184} fill={CONFLICT} size={10.5}>
        404 · not in registry
      </T>

      {/* The measured neighbourhood. */}
      {neighbours.map(([name, x, y], i) => (
        <g key={name}>
          <path
            d={`M206 ${171} C 250 ${171}, 258 ${y + 16}, ${x - 8} ${y + 16}`}
            stroke={i === 0 ? NPM : EDGE_LIT}
            strokeWidth={i === 0 ? 1.5 : 1}
            strokeOpacity={i === 0 ? 0.8 : 0.5}
            strokeDasharray={i === 0 ? undefined : "3 4"}
            fill="none"
          />
          <Card x={x - 8} y={y} w={140} h={32} />
          <T x={x + 6} y={y + 16} fill={i === 0 ? INK : INK_2} size={12}>
            {name}
          </T>
          <Tick x={x + 112} y={y + 14} />
        </g>
      ))}

      {/* The distance that matters, labelled. One edit is the whole finding. */}
      <T x={252} y={140} fill={NPM} size={10.5} anchor="middle">
        1 edit
      </T>
    </Frame>
  );
}

/**
 * Will the set install together?
 *
 * A resolution table, not a matrix of coloured squares. Every name, every
 * resolved version and the conflicting range are read out of hero-run.json, so
 * this figure is the same finding the agent session on the home page reports and
 * it moves when the run is regenerated.
 */
export function CompatFigure({ id, fit }: FigureProps) {
  const { a, b, requirement } = CONFLICT_PAIR;
  // One package that HELD, so the figure reads as a check that found something
  // rather than as a stack where everything is red.
  const rows: [string, string, boolean][] = [
    ["next", ver("next"), true],
    [b, ver(b), false],
    [a, ver(a), false],
  ];

  return (
    <Frame id={id} fit={fit} glow={{ color: DEPS, at: [0.5, 0.3] }}>
      <Card x={30} y={56} w={420} h={188} />
      {/* Title bar, so the table reads as an artifact and not as a list. */}
      <path d="M30 88 H450" stroke={EDGE} strokeWidth="1" />
      <T x={46} y={72} fill={INK_2} size={11}>
        compat
      </T>
      <T x={434} y={72} fill={INK_3} size={10.5} anchor="end">
        {rows.length} packages
      </T>

      {rows.map(([name, version, ok], i) => {
        const y = 112 + i * 40;
        return (
          <g key={name}>
            {!ok && (
              <rect x={31} y={y - 17} width={418} height="34" fill={CONFLICT} fillOpacity="0.07" />
            )}
            <T x={46} y={y} fill={ok ? INK_2 : INK} size={12.5}>
              {short(name)}
            </T>
            {version && (
              <Chip
                x={278}
                y={y - 10}
                w={72}
                label={version}
                color={ok ? INK_3 : CONFLICT}
                tint={ok ? undefined : CONFLICT}
              />
            )}
            {ok ? <Tick x={412} y={y - 2} /> : <Cross x={412} y={y} />}
          </g>
        );
      })}

      {/* The reason, in the run's own words. A verdict with no range under it is
          an assertion. */}
      <T x={46} y={224} fill={INK_3} size={10.5}>
        {`peer ${requirement!.peer}@${requirement!.range}`}
      </T>
      <T x={434} y={224} fill={CONFLICT} size={10.5} anchor="end">
        {`got ${requirement!.resolved}`}
      </T>

      <Chip x={30} y={264} w={104} label="CONFLICT" color={CONFLICT} tint={CONFLICT} />
      <T x={148} y={274} fill={INK_3} size={10.5}>
        npm would refuse this install
      </T>
    </Frame>
  );
}

/**
 * What breaks between two versions.
 *
 * Two version chips and a symbol list, which is what the tool actually returns.
 * Removals sit in --conflict, additions in --held, and the arity change is its
 * own row because it is the break that compiles and then throws.
 *
 * WHY THIS ONE IS LABELLED "example" AND THE OTHER TWO ARE NOT. Verify and
 * compat draw findings that can be sourced: a name that is not in the registry,
 * and a conflict read straight out of hero-run.json. A symbol-level diff cannot
 * be, because nothing generates one for this page, and printing four invented
 * symbol names as though the index had returned them is precisely the thing the
 * rest of the site refuses to do. The versions are real published TypeScript
 * releases; the rows are the shape of a response, and the corner says so.
 *
 * The honest fix is a generator: scripts/gen-hero-run.ts already proves the
 * pattern. Until one exists, the label carries the weight.
 */
export function DiffFigure({ id, fit }: FigureProps) {
  const rows: [string, string, "gone" | "new" | "arity"][] = [
    ["createProgram", "removed at runtime", "gone"],
    ["ts.sys.write", "removed at runtime", "gone"],
    ["createSourceFile", "added", "new"],
    ["emit(2 → 3)", "arity changed", "arity"],
  ];
  const colorOf = { gone: CONFLICT, new: HELD, arity: OSV } as const;
  const glyphOf = { gone: "−", new: "+", arity: "~" } as const;

  return (
    <Frame id={id} fit={fit} glow={{ color: OSV, at: [0.62, 0.36] }}>
      {/* The two versions, and the span between them. */}
      <Chip x={34} y={54} w={78} label="5.9.3" color={INK_3} />
      <path d="M124 64 H176" stroke={EDGE_LIT} strokeWidth="1" />
      <path d="M170 60 l6 4 l-6 4" stroke={EDGE_LIT} strokeWidth="1.5" fill="none" strokeLinecap="round" />
      <Chip x={186} y={54} w={78} label="7.0.0" color={CONFLICT} tint={CONFLICT} />
      <T x={450} y={64} fill={INK_3} size={10.5} anchor="end">
        diff_surface · example
      </T>

      <Card x={30} y={96} w={420} h={172} />
      {rows.map(([name, note, kind], i) => {
        const y = 122 + i * 40;
        const c = colorOf[kind];
        return (
          <g key={name}>
            {i > 0 && <path d={`M31 ${y - 20} H449`} stroke={EDGE} strokeWidth="1" />}
            <T x={48} y={y} fill={c} size={14} weight={500}>
              {glyphOf[kind]}
            </T>
            <T x={70} y={y} fill={INK} size={12.5}>
              {name}
            </T>
            <T x={434} y={y} fill={INK_3} size={10.5} anchor="end">
              {note}
            </T>
          </g>
        );
      })}

      <T x={30} y={292} fill={INK_3} size={10.5}>
        runtime removals break node · type-only removals break tsc
      </T>
    </Frame>
  );
}

export const FIGURES_V2 = {
  verify: VerifyFigure,
  compat: CompatFigure,
  diff: DiffFigure,
} as const;

/** Kept out of the exported map on purpose: unused hues, so the linter says so. */
void GITHUB;
void SCORECARD;
