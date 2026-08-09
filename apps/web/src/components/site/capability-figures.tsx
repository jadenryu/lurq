/**
 * One large figure per card, filling the tile the way a photograph would.
 *
 * TWO RULES, both learned by breaking them.
 *
 * 1. FIVE FORMS, NOT ONE. An earlier pass drew engines, surface and stack as
 *    rows of horizontal bars, which made three of the five cards the same
 *    picture. The vocabulary is now deliberately disjoint: a dial, a triangular
 *    matrix, vertical column ranges, an indented tree, and stacked slabs. No two
 *    share a silhouette, so the row reads as five instruments rather than one
 *    chart recoloured five times.
 *
 * 2. COLOUR IS A VERDICT, NOT INK. tokens.css is explicit that --held and
 *    --conflict are "a verdict and nothing else. Never a button, never
 *    decoration." Drawing whole figures in them made green mean nothing, and
 *    put it in a fight with the orange of the bloom underneath. Structure is
 *    --edge-lit, content is --ink-3, emphasis is --ink. A verdict colour appears
 *    only on something that genuinely passed or failed, which is at most a few
 *    marks per figure, and that is what makes those marks read.
 *
 * STILL NO NUMBERS OR NAMES. These show the form of an answer, never an answer.
 * Labelling an axis is where a diagram turns into a claim the page then owes a
 * provenance line for.
 *
 * 480x340 and sliced, so a wide tile crops rather than stretches and stroke
 * weights stay honest at every span.
 */

const STRUCT = "var(--edge-lit)";
/* The graph paper only, one step below STRUCT. The dots used to be drawn in
   --edge-lit like the structure they sit under, which put the background at the
   same value as the foreground and left the orange and the green competing with
   a lit grid instead of reading against a dark one. */
const PAPER = "var(--edge)";
const INK = "var(--ink)";
const MARK = "var(--ink-3)";
const HELD = "var(--held)";
const CONFLICT = "var(--conflict)";

type FigureProps = { id: string };

/**
 * Trig results differ in the last digit between the Node render and the browser
 * one, and React serialises the raw float into the attribute, so anything
 * derived from Math.cos/sin has to be rounded or it is a hydration mismatch.
 */
const round2 = (n: number): number => Math.round(n * 100) / 100;

/**
 * Depth, and no hue at all.
 *
 * This was the bloom for two passes and both were wrong. The two-stop version
 * washed orange under the drawings and went brown; the one-stop indigo version
 * turned the top of every tile navy while the plate below it stayed near-black,
 * so each card had two different grounds. The bloom is weather behind the hero
 * and the footer and a rim on the nav (tokens.css says so) and a panel is not
 * weather.
 *
 * A neutral lift does the one job that was actually wanted: keep the tile from
 * being a flat rectangle. Every hue on this card now belongs to a verdict.
 * `at` moves the light per card so the five are not one repeated texture.
 */
function Wash({ id, at }: { id: string; at: [number, number] }) {
  return (
    <>
      <defs>
        <radialGradient id={`${id}-wash`} cx={at[0]} cy={at[1]} r="0.9">
          <stop offset="0%" stopColor={INK} stopOpacity="0.05" />
          <stop offset="100%" stopColor={INK} stopOpacity="0" />
        </radialGradient>
      </defs>
      <rect width="480" height="340" fill={`url(#${id}-wash)`} />
    </>
  );
}

/**
 * The paper. Same 40px pitch as the hero field, so a figure here is drawn on the
 * same graph paper as the dependency graph up top rather than floating on a
 * plain dark tile. It is the single thing that makes these read as belonging to
 * this page.
 *
 * Every coordinate in every figure below is a multiple of 2 against this pitch,
 * so marks land on or between dots rather than at arbitrary offsets.
 */
function Paper({ id }: { id: string }) {
  return (
    <>
      <defs>
        <pattern id={`${id}-dots`} width="40" height="40" patternUnits="userSpaceOnUse">
          <circle cx="20" cy="20" r="1.2" fill={PAPER} />
        </pattern>
      </defs>
      <rect width="480" height="340" fill={`url(#${id}-dots)`} opacity="0.7" />
    </>
  );
}

/**
 * The 13px L-marks that used to sit in all four corners of every figure are
 * gone, along with the hero's set they were matched to. Two problems with them.
 * `preserveAspectRatio="slice"` crops a wide tile, so the left and right pairs
 * were being cut at arbitrary points and no card showed all four. And the plate
 * covers the bottom two, so what a reader actually saw was one bracket top-left
 * and a clipped something top-right: stray punctuation, not a crop frame.
 */
function Frame({ id, children }: { id: string; children: React.ReactNode }) {
  return (
    <svg
      aria-hidden
      viewBox="0 0 480 340"
      fill="none"
      preserveAspectRatio="xMidYMid slice"
      className="absolute inset-0 h-full w-full"
    >
      <Paper id={id} />
      {children}
    </svg>
  );
}

/**
 * A dial: many signals resolving to one reading.
 *
 * Drawn to the full 34..418 of the safe band. The first pass sat in 44..420 with
 * the bars only 150 wide and a 90-radius dial, which left a slack gap down the
 * middle of the widest tile on the page and read as a diagram floating in a box
 * rather than as the tile's picture. Six bars rather than five for the same
 * reason: the left column was short where the dial beside it was not.
 *
 * The dial's radius is set by the band, not by taste. The tightest band any
 * viewport produces is y 81..259: measured, not guessed, and it bottoms out
 * from 1280 up where the tile is at its widest 584 against a 216 figure. A
 * 84-radius dial spanned 86..254 inside that, five units of clearance at each
 * end, which at render scale is six pixels and reads as the circle resting on
 * the cut rather than sitting inside it. 74 at y 166 spans 92..240 and clears.
 *
 * Both numbers move if the figure height in capability-grid.tsx does.
 */
export function HealthFigure({ id }: FigureProps) {
  const rows = [0.86, 0.62, 0.94, 0.46, 0.78, 0.58];
  return (
    <Frame id={id}>
      <Wash id={id} at={[0.74, 0.24]} />
      {/* The stack runs 92..240 too, so the two halves of the card share a top
          and a bottom instead of each finding their own. */}
      {rows.map((v, i) => (
        <g key={i} transform={`translate(34 ${96 + i * 28})`}>
          <rect x="0" y="-4" width="190" height="8" rx="1" fill={STRUCT} opacity="0.5" />
          <rect x="0" y="-4" width={190 * v} height="8" rx="1" fill={MARK} opacity="0.8" />
        </g>
      ))}

      <g transform="translate(344 166)">
        {Array.from({ length: 36 }, (_, i) => {
          const a = (i / 36) * Math.PI * 2 - Math.PI / 2;
          const inner = i % 3 === 0 ? 64 : 68;
          return (
            <line
              key={i}
              x1={round2(Math.cos(a) * 74)}
              y1={round2(Math.sin(a) * 74)}
              x2={round2(Math.cos(a) * inner)}
              y2={round2(Math.sin(a) * inner)}
              stroke={STRUCT}
              strokeWidth="1"
            />
          );
        })}
        <circle r="52" stroke={STRUCT} strokeWidth="1" opacity="0.6" />
        {/* The one verdict on this card, so it is the one coloured thing. */}
        <circle
          r="52"
          stroke={HELD}
          strokeWidth="3"
          strokeLinecap="round"
          opacity="0.85"
          strokeDasharray={`${round2(2 * Math.PI * 52 * 0.79)} ${round2(2 * Math.PI * 52)}`}
          transform="rotate(-90)"
        />
      </g>
    </Frame>
  );
}

/**
 * A triangular matrix: every unordered pair, graded.
 *
 * Sized to the SAFE BAND, which is the thing to preserve when editing this. A
 * wide tile is 584x216 against a 480x340 viewBox, and `slice` scales on the
 * wider axis, so only y 81..259 of the drawing is ever on screen there. Both wide
 * figures are laid out to that band and both have to be re-fitted if the figure
 * height in capability-grid.tsx changes. An 8-wide matrix at a 38 pitch once ran
 * 40..298 and was guillotined at both ends: a half cell along the top edge, and a
 * row cut through by the plate whose conflict cell then came through the blur as
 * a smear.
 *
 * Six rows from y 90 clear the top of the band and grow down into the scrim, so
 * the triangle dissolves under the words rather than stopping short of them. Only
 * the first three rows are fully lit, and that is the intended read: enough of the
 * matrix to see it is every pair, not a table you are meant to count.
 *
 * The cells are wider than they are tall, and that is the only way this figure
 * fills a 584-wide tile. A triangle of square cells is as wide as it is high, and
 * the band caps the height at 176, so square cells left two thirds of the widest
 * tile on the page empty. Stretching x is the compromise that keeps six rows.
 */
export function PairsFigure({ id }: FigureProps) {
  const n = 7;
  const pitchX = 46;
  const pitchY = 28;
  const cellW = 40;
  const cellH = 24;
  const conflicts = new Set(["2-0", "3-2"]);
  const cells: { r: number; c: number; bad: boolean }[] = [];
  for (let r = 1; r < n; r++) {
    for (let c = 0; c < r; c++) cells.push({ r, c, bad: conflicts.has(`${r}-${c}`) });
  }
  return (
    <Frame id={id}>
      <Wash id={id} at={[0.24, 0.2]} />
      {/* x is off-centre by design. Centring the whole triangle put its visible
          mass (the top four rows, the only ones above the scrim) well left of
          the tile, because the rows that balance it are the faded ones. */}
      <g transform="translate(134 90)">
        {cells.map(({ r, c, bad }) => (
          <rect
            key={`${r}-${c}`}
            x={c * pitchX}
            y={(r - 1) * pitchY}
            width={cellW}
            height={cellH}
            rx="1.5"
            fill={bad ? CONFLICT : INK}
            fillOpacity={bad ? 0.82 : 0.05}
            stroke={bad ? CONFLICT : STRUCT}
            strokeWidth="1"
            strokeOpacity={bad ? 1 : 0.75}
          />
        ))}
        {Array.from({ length: n - 1 }, (_, i) => (
          <rect
            key={i}
            x="-28"
            y={i * pitchY + 9}
            width="16"
            height="6"
            rx="1"
            fill={MARK}
            opacity="0.45"
          />
        ))}
      </g>
    </Frame>
  );
}

/** Vertical column ranges against one horizontal runtime. */
export function EnginesFigure({ id }: FigureProps) {
  // [top, bottom] of each package's supported span, in figure coordinates.
  const cols: [number, number][] = [
    [70, 250],
    [96, 286],
    [58, 214],
    [142, 292],
    [82, 262],
    [64, 236],
    [110, 278],
  ];
  const runtime = 118;
  return (
    <Frame id={id}>
      <Wash id={id} at={[0.82, 0.7]} />
      {[70, 120, 170, 220, 270].map((y) => (
        <line key={y} x1="40" y1={y} x2="440" y2={y} stroke={STRUCT} strokeWidth="1" opacity="0.28" />
      ))}
      {cols.map(([top, bottom], i) => {
        // Fails when the declared span never reaches the runtime you deploy on.
        const bad = top > runtime || bottom < runtime;
        return (
          <rect
            key={i}
            x={44 + i * 58}
            y={top}
            width="34"
            height={bottom - top}
            rx="1.5"
            fill={bad ? CONFLICT : INK}
            fillOpacity={bad ? 0.8 : 0.14}
            stroke={bad ? CONFLICT : STRUCT}
            strokeWidth="1"
          />
        );
      })}
      {/* The runtime you actually ship on. */}
      <line
        x1="40"
        y1={runtime}
        x2="440"
        y2={runtime}
        stroke={MARK}
        strokeWidth="1.5"
        strokeDasharray="6 5"
      />
      <path d={`M40 ${runtime - 6}l9 6-9 6z`} fill={MARK} />
    </Frame>
  );
}

/**
 * An indented tree: the exported surface, and what left it.
 *
 * Widths run to ~370 of 480. At the old scale the longest row ended at 232 and
 * the right half of the tile was blank, which on a figure whose whole shape is a
 * ragged right edge read as the drawing having been cropped rather than as the
 * signatures being different lengths.
 */
export function SurfaceFigure({ id }: FigureProps) {
  // [depth, width, state], state 0 unchanged, 1 added, -1 gone.
  const rows: [number, number, number][] = [
    [0, 230, 0],
    [1, 190, 0],
    [1, 268, 1],
    [2, 150, 0],
    [2, 204, -1],
    [1, 174, 0],
    [0, 270, 0],
    [1, 214, 1],
    [1, 140, 0],
  ];
  const x0 = 54;
  const step = 46;
  const y0 = 40;
  const dy = 32;
  return (
    <Frame id={id}>
      <Wash id={id} at={[0.5, 0.16]} />
      {rows.map(([depth, w, state], i) => {
        const x = x0 + depth * step;
        const y = y0 + i * dy;
        // Elbow up to the nearest shallower row above.
        let parent = -1;
        for (let j = i - 1; j >= 0; j--) {
          if (rows[j]![0] < depth) {
            parent = j;
            break;
          }
        }
        const colour = state === -1 ? CONFLICT : state === 1 ? INK : MARK;
        return (
          <g key={i}>
            {parent >= 0 && (
              <path
                d={`M${x - 20} ${y0 + parent * dy + 8}V${y}h18`}
                stroke={STRUCT}
                strokeWidth="1"
                fill="none"
                opacity="0.8"
              />
            )}
            <rect
              x={x}
              y={y - 4}
              width={w}
              height="8"
              rx="1.5"
              fill={colour}
              opacity={state === 0 ? 0.45 : state === 1 ? 0.5 : 0.95}
            />
            {state === -1 && (
              <line
                x1={x}
                y1={y}
                x2={x + w}
                y2={y}
                stroke="var(--cap-ground)"
                strokeWidth="1.5"
                opacity="0.65"
              />
            )}
          </g>
        );
      })}
    </Frame>
  );
}

/** Stacked slabs: one stack, chosen against itself. */
export function StackFigure({ id }: FigureProps) {
  const slabs = [0, 1, 2, 3, 4];
  return (
    <Frame id={id}>
      <Wash id={id} at={[0.2, 0.78]} />
      {slabs.map((i) => {
        const x = 84 + i * 24;
        const y = 54 + i * 48;
        const chosen = i === 2;
        return (
          <g key={i}>
            <rect
              x={x}
              y={y}
              width="258"
              height="40"
              rx="2"
              fill={INK}
              fillOpacity={chosen ? 0.09 : 0.04}
              stroke={chosen ? MARK : STRUCT}
              strokeWidth="1"
            />
            <rect x={x + 18} y={y + 16} width="10" height="8" rx="1" fill={MARK} opacity="0.7" />
            <rect
              x={x + 40}
              y={y + 17}
              width={chosen ? 152 : 112 + i * 10}
              height="6"
              rx="1"
              fill={INK}
              opacity={chosen ? 0.42 : 0.2}
            />
          </g>
        );
      })}
      {/* The spine: what makes it a stack and not five separate answers. */}
      <path d="M382 80L262 272" stroke={STRUCT} strokeWidth="1" strokeDasharray="4 5" opacity="0.9" />
      {slabs.map((i) => (
        <circle key={i} cx={382 - i * 30} cy={80 + i * 48} r="3.5" fill={i === 2 ? HELD : STRUCT} />
      ))}
    </Frame>
  );
}

export const FIGURES = {
  health: HealthFigure,
  pairs: PairsFigure,
  engines: EnginesFigure,
  surface: SurfaceFigure,
  stack: StackFigure,
} as const;

export type FigureName = keyof typeof FIGURES;
