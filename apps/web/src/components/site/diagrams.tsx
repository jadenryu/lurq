/**
 * The figure set for the tool pages, drawn in the same hand as the bento.
 *
 * capability-figures.tsx laid down the rules and this file obeys them rather
 * than restating them: structure is --edge-lit, content is --ink-3, emphasis is
 * --ink, and a verdict colour appears only on a mark that genuinely passed or
 * failed. Read the header there before adding a figure here.
 *
 * WHY SIX NEW ONES AND NOT TEN. Five of the ten tools are already drawn. The
 * bento's dial is evaluate's picture, its pair matrix is compat's, its column
 * ranges are the engines check inside compat, its indented tree is usage, and
 * its stacked slabs are diagram. Redrawing those would give the same tool two
 * different pictures on two pages, which is worse than reuse: a reader who saw
 * the dial on the landing page should recognise it on /product/evaluate. Only
 * the six with no existing picture are drawn below.
 *
 * SILHOUETTE RULE, inherited. No two figures in the combined set of eleven share
 * an outline. The six here are: a proximity ring, a parallel-coordinates fan, a
 * container cut open, two tracks with marks between them, a beam fanning to a
 * row, and a closed loop. None of those is a bar chart, which is the shape every
 * one of them would have collapsed into if drawn quickly.
 *
 * STILL NO NUMBERS OR NAMES. Same rule, same reason: a labelled axis is a claim,
 * and a claim needs a provenance line the figure cannot carry.
 */
import { FIGURES_V2 } from "@/components/site/figures";
import {
  CONFLICT,
  FIGURES,
  Frame,
  HELD,
  INK,
  MARK,
  STRUCT,
  Wash,
  round2,
  type FigureProps,
} from "@/components/site/capability-figures";

/**
 * Proximity: one name, and the real names it sits closest to.
 *
 * The centre is the string an agent produced. The ring is the neighbourhood of
 * genuine packages within a short edit distance of it, which is the measurement
 * verify actually makes. One neighbour is close enough to be the thing that was
 * meant, and that node is the only coloured mark in the figure.
 *
 * Drawn on radii rather than on a grid because the point is distance. A row of
 * boxes would have said "a list of similar packages", which is the wrong idea:
 * what matters is that the invented name has no ring of its own and is sitting
 * inside someone else's.
 */
export function VerifyFigure({ id, fit }: FigureProps) {
  const rings = [58, 96, 134];
  /** Bearing and which ring, hand-placed so no two nodes stack on one radius. */
  const nodes: [number, number][] = [
    [-72, 0], [24, 0], [148, 0],
    [-24, 1], [64, 1], [126, 1], [-140, 1],
    [-52, 2], [8, 2], [88, 2], [168, 2], [-108, 2],
  ];
  return (
    <Frame id={id} fit={fit}>
      <Wash id={id} at={[0.5, 0.42]} />
      <g transform="translate(240 170)">
        {rings.map((r) => (
          <circle
            key={r}
            r={r}
            stroke={STRUCT}
            strokeWidth="1"
            opacity={r === 58 ? 0.7 : 0.4}
            strokeDasharray={r === 58 ? undefined : "2 5"}
          />
        ))}

        {nodes.map(([deg, ring], i) => {
          const a = (deg * Math.PI) / 180;
          const r = rings[ring];
          // The nearest neighbour: innermost ring, and the only node the figure
          // colours. Everything else on the ring is a real package that is
          // simply not this one.
          const near = i === 1;
          return (
            <circle
              key={`${deg}-${ring}`}
              cx={round2(Math.cos(a) * r)}
              cy={round2(Math.sin(a) * r)}
              r={near ? 5 : 3.5}
              fill={near ? CONFLICT : MARK}
              opacity={near ? 0.95 : 0.55}
            />
          );
        })}

        {/* The name under test. Hollow: nothing in the registry backs it. */}
        <circle r="11" fill="var(--surface)" stroke={CONFLICT} strokeWidth="2" />
        <line x1="-4.5" y1="-4.5" x2="4.5" y2="4.5" stroke={CONFLICT} strokeWidth="2" strokeLinecap="round" />
        <line x1="4.5" y1="-4.5" x2="-4.5" y2="4.5" stroke={CONFLICT} strokeWidth="2" strokeLinecap="round" />

        {/* The one measured distance, to the neighbour it was probably meant to be. */}
        <line
          x1="11"
          y1="0"
          x2={round2(Math.cos((24 * Math.PI) / 180) * 58 - 6)}
          y2={round2(Math.sin((24 * Math.PI) / 180) * 58 - 3)}
          stroke={CONFLICT}
          strokeWidth="1.5"
          strokeDasharray="3 3"
          opacity="0.8"
        />
      </g>
    </Frame>
  );
}

/**
 * Parallel coordinates: candidates as lines across shared axes.
 *
 * The only honest picture of a comparison. A bar chart per package invites the
 * reader to add the bars up, which is exactly the composite-score reading the
 * tool's own copy argues against; parallel axes make the crossing visible, and
 * the crossing is the answer. Where the lines cross is where the choice is real.
 *
 * One line is lit and the rest are not, because a figure with three equal lines
 * is a chart and a figure with one is a recommendation.
 */
export function CompareFigure({ id, fit }: FigureProps) {
  const axes = [70, 175, 280, 385];
  /** Three candidates, four axes each, as a fraction of the axis height. */
  const series: number[][] = [
    [0.82, 0.44, 0.9, 0.68],
    [0.55, 0.86, 0.42, 0.74],
    [0.36, 0.3, 0.62, 0.28],
  ];
  const top = 74;
  const height = 188;
  const y = (v: number) => round2(top + height * (1 - v));

  return (
    <Frame id={id} fit={fit}>
      <Wash id={id} at={[0.28, 0.3]} />
      {axes.map((x) => (
        <g key={x}>
          <line x1={x} y1={top} x2={x} y2={top + height} stroke={STRUCT} strokeWidth="1" opacity="0.65" />
          {/* Tick pairs, so an axis reads as measured rather than as a rule. */}
          {[0, 0.25, 0.5, 0.75, 1].map((t) => (
            <line
              key={t}
              x1={x - 4}
              y1={round2(top + height * t)}
              x2={x + 4}
              y2={round2(top + height * t)}
              stroke={STRUCT}
              strokeWidth="1"
              opacity="0.5"
            />
          ))}
        </g>
      ))}

      {series.map((values, s) => {
        const lead = s === 0;
        return (
          <g key={s}>
            <polyline
              points={values.map((v, i) => `${axes[i]},${y(v)}`).join(" ")}
              stroke={lead ? INK : MARK}
              strokeWidth={lead ? 2 : 1.25}
              opacity={lead ? 0.95 : 0.4}
              fill="none"
              strokeLinejoin="round"
            />
            {values.map((v, i) => (
              <circle
                key={i}
                cx={axes[i]}
                cy={y(v)}
                r={lead ? 3.5 : 2.5}
                fill={lead ? INK : MARK}
                opacity={lead ? 0.95 : 0.45}
              />
            ))}
          </g>
        );
      })}
    </Frame>
  );
}

/**
 * A container cut open: the published artifact, and what is really inside it.
 *
 * resolve_surface reads the shipped JavaScript rather than the types or the
 * README, so the figure is a sealed box with its lid lifted and the symbols
 * spilling out as a list. The two ticks are runtime exports that were found; the
 * outlined row is the UNKNOWN case, which is the state the tool's copy is most
 * careful about and therefore the one the drawing has to show.
 */
export function ResolveFigure({ id, fit }: FigureProps) {
  const rows = [0, 1, 2, 3, 4];
  return (
    <Frame id={id} fit={fit}>
      <Wash id={id} at={[0.36, 0.26]} />

      {/* The tarball. Deliberately drawn closed on three sides. */}
      <g transform="translate(52 96)">
        <path
          d="M0 24 L0 148 L112 148 L112 24"
          stroke={STRUCT}
          strokeWidth="1.5"
          fill="var(--surface-2)"
          opacity="0.9"
        />
        {/* The lid, hinged open. */}
        <path d="M-6 24 L118 24" stroke={STRUCT} strokeWidth="1.5" />
        <path d="M-2 18 L116 -8" stroke={STRUCT} strokeWidth="1.5" opacity="0.7" />
        {/* Bytes inside, not symbols: this is the file, not the answer. */}
        {[0, 1, 2, 3].map((i) => (
          <rect
            key={i}
            x="18"
            y={48 + i * 22}
            width={i % 2 ? 58 : 76}
            height="6"
            rx="1"
            fill={MARK}
            opacity="0.35"
          />
        ))}
      </g>

      {/* The extracted list. */}
      {rows.map((i) => {
        const unknown = i === 3;
        const yTop = 92 + i * 34;
        return (
          <g key={i} transform={`translate(214 ${yTop})`}>
            <line x1="-32" y1="10" x2="-8" y2="10" stroke={STRUCT} strokeWidth="1" opacity="0.5" />
            <rect
              x="0"
              y="0"
              width="216"
              height="20"
              rx="2"
              fill={unknown ? "none" : "var(--surface-2)"}
              stroke={unknown ? STRUCT : "none"}
              strokeWidth="1"
              strokeDasharray={unknown ? "3 3" : undefined}
              opacity={unknown ? 0.9 : 0.75}
            />
            <rect
              x="10"
              y="7"
              width={[92, 128, 74, 110, 86][i]}
              height="6"
              rx="1"
              fill={unknown ? MARK : INK}
              opacity={unknown ? 0.4 : 0.7}
            />
            {/* Only a found symbol gets a verdict mark. UNKNOWN gets nothing,
                which is the whole point: it is not an absence. */}
            {!unknown && (
              <path
                d="M196 10 l4 4 l8 -9"
                stroke={HELD}
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                fill="none"
                opacity="0.85"
              />
            )}
          </g>
        );
      })}
    </Frame>
  );
}

/**
 * Two tracks, and the marks that only exist between them.
 *
 * A diff is not a list, it is a relation, so the figure draws both versions as
 * vertical tracks and puts every finding in the gutter. Removals sit on the left
 * track and stop there; additions start on the right; the two ties that run all
 * the way across are the symbols that survived, which is what makes the broken
 * ones read as broken.
 *
 * The one arity change is drawn as a tie that crosses and shifts, because that
 * is the break that compiles and then throws: still connected, no longer the
 * same shape.
 */
export function DiffFigure({ id, fit }: FigureProps) {
  const left = 128;
  const right = 352;
  /** kind, y on the left track, y on the right track. */
  const ties: [("held" | "gone" | "new" | "arity"), number, number][] = [
    ["held", 92, 92],
    ["gone", 126, 0],
    ["held", 160, 160],
    ["arity", 194, 208],
    ["new", 0, 126],
    ["gone", 228, 0],
    ["new", 0, 242],
  ];
  return (
    <Frame id={id} fit={fit}>
      <Wash id={id} at={[0.5, 0.24]} />
      {[left, right].map((x) => (
        <line key={x} x1={x} y1="70" x2={x} y2="272" stroke={STRUCT} strokeWidth="1.5" opacity="0.7" />
      ))}

      {ties.map(([kind, ly, ry], i) => {
        if (kind === "held") {
          return (
            <g key={i}>
              <line x1={left} y1={ly} x2={right} y2={ry} stroke={MARK} strokeWidth="1.25" opacity="0.45" />
              <circle cx={left} cy={ly} r="3" fill={MARK} opacity="0.6" />
              <circle cx={right} cy={ry} r="3" fill={MARK} opacity="0.6" />
            </g>
          );
        }
        if (kind === "arity") {
          return (
            <g key={i}>
              <path
                d={`M${left} ${ly} C ${left + 72} ${ly}, ${right - 72} ${ry}, ${right} ${ry}`}
                stroke={INK}
                strokeWidth="1.75"
                fill="none"
                opacity="0.8"
              />
              <circle cx={left} cy={ly} r="3.5" fill={INK} opacity="0.85" />
              <circle cx={right} cy={ry} r="3.5" fill={INK} opacity="0.85" />
            </g>
          );
        }
        const gone = kind === "gone";
        const x = gone ? left : right;
        const y = gone ? ly : ry;
        const dir = gone ? 1 : -1;
        return (
          <g key={i}>
            {/* Stops in the gutter. A removal has nowhere to land, and drawing
                it as a line to nothing is more legible than a red dot. */}
            <line
              x1={x}
              y1={y}
              x2={x + dir * 46}
              y2={y}
              stroke={gone ? CONFLICT : HELD}
              strokeWidth="1.5"
              strokeDasharray="4 4"
              opacity="0.85"
            />
            <circle cx={x} cy={y} r="3.5" fill={gone ? CONFLICT : HELD} opacity="0.9" />
            {gone ? (
              <g stroke={CONFLICT} strokeWidth="2" strokeLinecap="round" opacity="0.9">
                <line x1={x + 42} y1={y - 4} x2={x + 50} y2={y + 4} />
                <line x1={x + 50} y1={y - 4} x2={x + 42} y2={y + 4} />
              </g>
            ) : (
              <g stroke={HELD} strokeWidth="2" strokeLinecap="round" opacity="0.9">
                <line x1={x - 46} y1={y} x2={x - 38} y2={y} />
                <line x1={x - 42} y1={y - 4} x2={x - 42} y2={y + 4} />
              </g>
            )}
          </g>
        );
      })}
    </Frame>
  );
}

/**
 * One question, fanning to the tools that could answer it, one of them lit.
 *
 * capabilities is a lookup, so the figure is a routing diagram: a single query
 * on the left, a fan, and a row of tool seats on the right with exactly one
 * carrying weight. Two dimmer paths survive because the tool returns matches
 * rather than a single answer, and drawing one path would have promised a
 * certainty the schema does not.
 */
export function CapabilitiesFigure({ id, fit }: FigureProps) {
  const seats = [88, 122, 156, 190, 224, 258];
  const hit = 2;
  const alt = new Set([1, 4]);
  return (
    <Frame id={id} fit={fit}>
      <Wash id={id} at={[0.22, 0.44]} />

      {/* The query. A bar, not a box: it is a sentence. */}
      <g transform="translate(46 164)">
        <rect x="0" y="-11" width="86" height="22" rx="3" fill="var(--surface-2)" stroke={STRUCT} strokeWidth="1" />
        <rect x="10" y="-3" width="52" height="6" rx="1" fill={INK} opacity="0.6" />
      </g>

      {seats.map((y, i) => {
        const lit = i === hit;
        const dim = alt.has(i);
        const opacity = lit ? 0.9 : dim ? 0.4 : 0.14;
        return (
          <g key={y}>
            <path
              d={`M132 164 C 220 164, 236 ${y}, 300 ${y}`}
              stroke={lit ? INK : MARK}
              strokeWidth={lit ? 2 : 1}
              fill="none"
              opacity={opacity}
            />
            <rect
              x="300"
              y={y - 11}
              width="132"
              height="22"
              rx="3"
              fill={lit ? "var(--surface-2)" : "none"}
              stroke={lit ? INK : STRUCT}
              strokeWidth="1"
              opacity={lit ? 0.95 : 0.55}
            />
            <rect
              x="310"
              y={y - 3}
              width={[64, 88, 74, 96, 58, 80][i]}
              height="6"
              rx="1"
              fill={lit ? INK : MARK}
              opacity={lit ? 0.85 : 0.35}
            />
          </g>
        );
      })}
    </Frame>
  );
}

/**
 * A closed loop, which is the only figure here that is not a left-to-right read.
 *
 * report_outcome is the one tool that writes rather than reads, and the reason
 * it exists is that the write comes back around: a recommendation is acted on, a
 * build either holds or does not, and the result re-weights the score that
 * produced the recommendation. Drawn as a cycle because a pipeline drawn as an
 * arrow would have shown the feedback going nowhere, which is the arrangement
 * this tool is the fix for.
 *
 * The gap in the ring is deliberate and is where the build signal enters: a
 * closed circle with no opening reads as a process with no input.
 */
export function OutcomeFigure({ id, fit }: FigureProps) {
  const r = 96;
  const stops = [-90, -18, 54, 126, 198];
  return (
    <Frame id={id} fit={fit}>
      <Wash id={id} at={[0.5, 0.4]} />
      <g transform="translate(240 172)">
        {/* Arc rather than circle: the run from 210deg to 130deg, leaving the
            gap the signal comes in through. */}
        <path
          d={`M ${round2(Math.cos((210 * Math.PI) / 180) * r)} ${round2(Math.sin((210 * Math.PI) / 180) * r)}
              A ${r} ${r} 0 1 1 ${round2(Math.cos((130 * Math.PI) / 180) * r)} ${round2(Math.sin((130 * Math.PI) / 180) * r)}`}
          stroke={STRUCT}
          strokeWidth="1.5"
          fill="none"
          opacity="0.8"
        />

        {stops.map((deg, i) => {
          const a = (deg * Math.PI) / 180;
          const cx = round2(Math.cos(a) * r);
          const cy = round2(Math.sin(a) * r);
          // The build signal: the one node with an outcome attached.
          const built = i === 2;
          return (
            <g key={deg}>
              <circle
                cx={cx}
                cy={cy}
                r={built ? 9 : 6}
                fill="var(--surface)"
                stroke={built ? HELD : STRUCT}
                strokeWidth={built ? 2 : 1.5}
              />
              {built && (
                <path
                  d={`M${cx - 4} ${cy} l3 3.5 l6 -7`}
                  stroke={HELD}
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  fill="none"
                />
              )}
            </g>
          );
        })}

        {/* The return leg: back into the middle, which is the score. */}
        <line
          x1={round2(Math.cos((54 * Math.PI) / 180) * (r - 12))}
          y1={round2(Math.sin((54 * Math.PI) / 180) * (r - 12))}
          x2="18"
          y2="10"
          stroke={HELD}
          strokeWidth="1.5"
          strokeDasharray="4 4"
          opacity="0.8"
        />
        <circle r="26" fill="var(--surface-2)" stroke={STRUCT} strokeWidth="1" />
        <rect x="-13" y="-4" width="26" height="8" rx="1" fill={INK} opacity="0.55" />
      </g>
    </Frame>
  );
}

/**
 * Eleven figures, five of them the bento's.
 *
 * The reuse is named here rather than hidden behind a copy, so a reader of this
 * map can see that /product/evaluate and the landing page's first card are
 * deliberately the same drawing.
 */
export const DIAGRAMS = {
  /* THREE ARE REBUILT, EIGHT ARE NOT, AND THIS MAP IS THE SEAM.
     figures.tsx draws labelled technical drawings with real data and real
     colour; everything still pointing at this file is the old unlabelled
     geometry. The three below are the exemplars, deliberately the three whose
     findings can be sourced. See the header of figures.tsx for why the old set
     read as generated, and expect the rest of this map to migrate. */
  verify: FIGURES_V2.verify,
  evaluate: FIGURES.health,
  compare: CompareFigure,
  compat: FIGURES_V2.compat,
  engines: FIGURES.engines,
  usage: FIGURES.surface,
  diagram: FIGURES.stack,
  resolve: ResolveFigure,
  diff: FIGURES_V2.diff,
  capabilities: CapabilitiesFigure,
  outcome: OutcomeFigure,
} as const;

export type DiagramName = keyof typeof DIAGRAMS;
