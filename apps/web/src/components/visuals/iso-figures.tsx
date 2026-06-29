import { cn } from "@/lib/utils";

// ─────────────────────────────────────────────────────────────────────────
// Isometric line-art primitive.
//
// Describe shapes as lists of 3D points; `iso()` projects them onto the screen
// using a true 30° isometric: +x runs down-right, +y down-left, +z straight up.
// Edges are drawn as hairline strokes in `currentColor`, so the figures inherit
// the page's text color and stay monochrome + themeable. Strokes use
// `non-scaling-stroke`, so they're a crisp ~1px at any rendered size.
// ─────────────────────────────────────────────────────────────────────────

const A = Math.PI / 6;
const COS = Math.cos(A);
const SIN = Math.sin(A);

type P3 = [number, number, number];
type P2 = [number, number];
type Tone = "bright" | "mid" | "dim";

function iso([x, y, z]: P3): P2 {
  return [(x - y) * COS, (x + y) * SIN - z];
}

const TONE: Record<Tone, string> = {
  bright: "text-white/70",
  mid: "text-white/[0.38]",
  dim: "text-white/[0.18]",
};

type Stroke = { pts: P3[]; tone: Tone; close?: boolean; dash?: boolean };
type Dot = { p: P3; tone: Tone };
type Figure = { strokes: Stroke[]; dots?: Dot[] };

// ── geometry builders ──────────────────────────────────────────────────────

/** The three visible faces of an axis-aligned box at origin `o`, size `s`. */
function box(
  o: P3,
  s: P3,
  tones: { top: Tone; left: Tone; right: Tone } = {
    top: "bright",
    left: "mid",
    right: "dim",
  },
): Stroke[] {
  const [x, y, z] = o;
  const [w, d, h] = s;
  return [
    {
      tone: tones.top,
      pts: [
        [x, y, z + h],
        [x + w, y, z + h],
        [x + w, y + d, z + h],
        [x, y + d, z + h],
      ],
    },
    {
      tone: tones.left,
      pts: [
        [x, y + d, z],
        [x + w, y + d, z],
        [x + w, y + d, z + h],
        [x, y + d, z + h],
      ],
    },
    {
      tone: tones.right,
      pts: [
        [x + w, y, z],
        [x + w, y + d, z],
        [x + w, y + d, z + h],
        [x + w, y, z + h],
      ],
    },
  ];
}

/** A closed loop sampled on a plane, from a center and two basis vectors. */
function loop(c: P3, r: number, u: P3, v: P3, n = 56): P3[] {
  const pts: P3[] = [];
  for (let i = 0; i < n; i++) {
    const t = (i / n) * Math.PI * 2;
    const ct = Math.cos(t) * r;
    const st = Math.sin(t) * r;
    pts.push([
      c[0] + ct * u[0] + st * v[0],
      c[1] + ct * u[1] + st * v[1],
      c[2] + ct * u[2] + st * v[2],
    ]);
  }
  return pts;
}

/** A small grid of dots on a top face — reads as a vent / port. */
function vent(x: number, y: number, z: number, tone: Tone): Dot[] {
  const dots: Dot[] = [];
  for (let i = 0; i < 3; i++)
    for (let j = 0; j < 3; j++)
      dots.push({ p: [x + i * 0.28, y + j * 0.28, z], tone });
  return dots;
}

// ── the three figures ───────────────────────────────────────────────────────

// FIG 0.2 — a layered base with a floating lid and a disc motif: "the index".
function figLayers(): Figure {
  const strokes: Stroke[] = [];
  const lh = 0.5;
  const gap = 0.34;
  const layers = 5;
  for (let i = 0; i < layers; i++) {
    const z = i * (lh + gap);
    strokes.push(...box([0, 0, z], [4, 4, lh]));
  }
  const baseTop = (layers - 1) * (lh + gap) + lh;
  const lidZ = baseTop + 1.1;
  strokes.push(
    ...box([-0.3, -0.3, lidZ], [4.6, 4.6, 0.5], {
      top: "bright",
      left: "mid",
      right: "mid",
    }),
  );

  // disc + horizon lines on the lid's top face
  const lidTop = lidZ + 0.5;
  const cx = 2;
  const cy = 2;
  strokes.push({
    tone: "bright",
    pts: loop([cx, cy, lidTop], 1.25, [1, 0, 0], [0, 1, 0]),
  });
  for (const dy of [-0.4, 0.15, 0.7]) {
    const half = Math.sqrt(Math.max(0, 1.25 * 1.25 - dy * dy));
    strokes.push({
      tone: "mid",
      close: false,
      pts: [
        [cx - half, cy + dy, lidTop],
        [cx + half, cy + dy, lidTop],
      ],
    });
  }

  // dotted leaders tying the lid back to the stack
  for (const [x, y] of [
    [0, 0],
    [4, 0],
    [0, 4],
    [4, 4],
  ] as const) {
    strokes.push({
      tone: "dim",
      close: false,
      dash: true,
      pts: [
        [x, y, baseTop],
        [x, y, lidZ],
      ],
    });
  }
  return { strokes };
}

// FIG 0.3 — a cluster of modules of varying height: "scored packages".
function figModules(): Figure {
  const strokes: Stroke[] = [];
  const dots: Dot[] = [];
  // back-to-front so nearer boxes paint over farther ones
  strokes.push(...box([0.2, 0.2, 0], [2.3, 2.3, 2.7]));
  dots.push(...vent(0.85, 0.85, 2.7, "mid"));
  strokes.push(...box([3.1, 0.2, 0], [2.3, 2.3, 1.7]));
  strokes.push(...box([0.2, 3.1, 0], [2.3, 2.3, 1.5]));
  strokes.push(...box([3.0, 3.0, 0], [2.4, 2.4, 2.0]));
  dots.push(...vent(3.65, 3.65, 2.0, "mid"));
  return { strokes, dots };
}

// FIG 0.4 — a fanned sheaf of sheets: "ranked results".
function figSheaf(): Figure {
  const strokes: Stroke[] = [];
  const n = 12;
  const g = 0.46; // spacing along y (down-left)
  const w = 3.4;
  for (let i = 0; i < n; i++) {
    const y = i * g;
    const x = i * 0.16; // slight horizontal splay
    const h = 0.7 + i * 0.42; // grows toward the back
    const tone: Tone = i === n - 1 ? "bright" : i > n - 4 ? "mid" : "dim";
    strokes.push({
      tone,
      pts: [
        [x, y, 0],
        [x + w, y, 0],
        [x + w, y, h],
        [x, y, h],
      ],
    });
  }
  return { strokes };
}

// ── renderer ────────────────────────────────────────────────────────────────

function FigureSvg({ figure }: { figure: Figure }) {
  const projected = figure.strokes.map((s) => ({
    ...s,
    p2: s.pts.map(iso),
  }));
  const dots = (figure.dots ?? []).map((d) => ({ ...d, p2: iso(d.p) }));

  // auto-fit viewBox from every projected point
  const all: P2[] = [
    ...projected.flatMap((s) => s.p2),
    ...dots.map((d) => d.p2),
  ];
  const xs = all.map((p) => p[0]);
  const ys = all.map((p) => p[1]);
  const pad = 0.6;
  const minX = Math.min(...xs) - pad;
  const minY = Math.min(...ys) - pad;
  const vw = Math.max(...xs) - minX + pad;
  const vh = Math.max(...ys) - minY + pad;

  return (
    <svg
      viewBox={`${minX} ${minY} ${vw} ${vh}`}
      className="h-auto w-full"
      fill="none"
      aria-hidden
    >
      {projected.map((s, i) => {
        const d =
          s.p2
            .map(([x, y], j) => `${j === 0 ? "M" : "L"}${x} ${y}`)
            .join(" ") + (s.close === false ? "" : " Z");
        return (
          <path
            key={i}
            d={d}
            stroke="currentColor"
            strokeWidth={1}
            strokeLinejoin="round"
            strokeLinecap="round"
            vectorEffect="non-scaling-stroke"
            strokeDasharray={s.dash ? "2 3" : undefined}
            className={TONE[s.tone]}
          />
        );
      })}
      {dots.map((d, i) => (
        <circle
          key={`d${i}`}
          cx={d.p2[0]}
          cy={d.p2[1]}
          r={0.08}
          fill="currentColor"
          className={TONE[d.tone]}
        />
      ))}
    </svg>
  );
}

const FIGURES: { id: string; label: string; figure: Figure }[] = [
  { id: "layers", label: "FIG 0.2", figure: figLayers() },
  { id: "modules", label: "FIG 0.3", figure: figModules() },
  { id: "sheaf", label: "FIG 0.4", figure: figSheaf() },
];

/** A single figure, e.g. <IsoFigure name="modules" />. */
export function IsoFigure({
  name,
  className,
}: {
  name: "layers" | "modules" | "sheaf";
  className?: string;
}) {
  const item = FIGURES.find((f) => f.id === name) ?? FIGURES[0];
  return (
    <figure className={cn("text-foreground", className)}>
      <FigureSvg figure={item.figure} />
    </figure>
  );
}

/** The three figures in a labelled, divided row (matches the reference). */
export function IsoFigures({ className }: { className?: string }) {
  return (
    <div className={cn("grid gap-px sm:grid-cols-3", className)}>
      {FIGURES.map(({ id, label, figure }) => (
        <div key={id} className="relative px-8 py-12 sm:px-10">
          <span className="absolute left-8 top-8 font-mono text-[11px] uppercase tracking-[0.22em] text-muted-foreground sm:left-10">
            {label}
          </span>
          <div className="mx-auto mt-6 max-w-[15rem] text-foreground">
            <FigureSvg figure={figure} />
          </div>
        </div>
      ))}
    </div>
  );
}
