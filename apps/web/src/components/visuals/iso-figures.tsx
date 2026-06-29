import { cn } from "@/lib/utils";

// ─────────────────────────────────────────────────────────────────────────
// Isometric line-art primitive.
//
// Describe shapes as lists of 3D points; `iso()` projects them with a true 30°
// isometric (+x down-right, +y down-left, +z up). The look comes from two
// things working together:
//
//   1. Hidden-line removal: every face is filled with the surface color behind
//      it and drawn back-to-front (painter's algorithm), so nearer geometry
//      occludes farther edges. Without this it reads as transparent wireframe.
//   2. Rounded corners: each polygon vertex becomes a short quadratic curve.
//
// Strokes are `currentColor` at varying opacity, so figures stay monochrome and
// inherit the page's text color. `non-scaling-stroke` keeps them a crisp ~1px.
// ─────────────────────────────────────────────────────────────────────────

const A = Math.PI / 6;
const COS = Math.cos(A);
const SIN = Math.sin(A);
const CORNER = 0.22;

type P3 = [number, number, number];
type P2 = [number, number];
type Tone = "bright" | "mid" | "dim";

function iso([x, y, z]: P3): P2 {
  return [(x - y) * COS, (x + y) * SIN - z];
}

const TONE: Record<Tone, string> = {
  bright: "text-white/70",
  mid: "text-white/40",
  dim: "text-white/[0.18]",
};

type Face = { pts: P3[]; tone: Tone };
type Deco = { pts: P3[]; tone: Tone; close?: boolean; dash?: boolean };
type Dot = { p: P3; tone: Tone };
type Figure = { faces: Face[]; decos?: Deco[]; dots?: Dot[] };

const depth = (pts: P3[]) =>
  pts.reduce((a, p) => a + p[0] + p[1] + p[2], 0) / pts.length;

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
): Face[] {
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
function loop(c: P3, r: number, u: P3, v: P3, n = 60): P3[] {
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

/** A small grid of dots on a top face: reads as a vent / port. */
function vent(x: number, y: number, z: number, tone: Tone): Dot[] {
  const dots: Dot[] = [];
  for (let i = 0; i < 3; i++)
    for (let j = 0; j < 3; j++)
      dots.push({ p: [x + i * 0.26, y + j * 0.26, z], tone });
  return dots;
}

// ── the three figures ───────────────────────────────────────────────────────

// FIG 0.2: layered base with a floating lid and a disc motif ("the index").
function figLayers(): Figure {
  const faces: Face[] = [];
  const decos: Deco[] = [];
  const lh = 0.42;
  const gap = 0.16;
  const layers = 6;
  for (let i = 0; i < layers; i++)
    faces.push(...box([0, 0, i * (lh + gap)], [4, 4, lh]));

  const baseTop = (layers - 1) * (lh + gap) + lh;
  const lidZ = baseTop + 0.95;
  faces.push(
    ...box([-0.3, -0.3, lidZ], [4.6, 4.6, 0.42], {
      top: "bright",
      left: "mid",
      right: "mid",
    }),
  );

  const lidTop = lidZ + 0.42;
  const r = 1.25;
  decos.push({ tone: "bright", pts: loop([2, 2, lidTop], r, [1, 0, 0], [0, 1, 0]) });
  for (const dy of [-0.5, 0, 0.5]) {
    const half = Math.sqrt(Math.max(0, r * r - dy * dy));
    decos.push({
      tone: "mid",
      close: false,
      pts: [
        [2 - half, 2 + dy, lidTop],
        [2 + half, 2 + dy, lidTop],
      ],
    });
  }
  for (const [x, y] of [
    [0, 0],
    [4, 0],
    [0, 4],
    [4, 4],
  ] as const)
    decos.push({
      tone: "dim",
      close: false,
      dash: true,
      pts: [
        [x, y, baseTop],
        [x, y, lidZ],
      ],
    });
  return { faces, decos };
}

// FIG 0.3: 2×2 cluster of modules of varying height ("scored packages").
function figModules(): Figure {
  const faces: Face[] = [];
  const dots: Dot[] = [];
  const c = 2.4;
  const g = 0.12; // small seam between modules
  faces.push(...box([0, 0, 0], [c, c, 2.7])); // back (tall)
  dots.push(...vent(0.75, 0.75, 2.7, "mid"));
  faces.push(...box([c + g, 0, 0], [c, c, 1.7])); // right
  faces.push(...box([0, c + g, 0], [c, c, 1.9])); // left
  faces.push(...box([c + g, c + g, 0], [c, c, 2.0])); // front
  dots.push(...vent(c + g + 0.75, c + g + 0.75, 2.0, "mid"));
  return { faces, dots };
}

// FIG 0.4: fanned sheaf of sheets, tallest at the back ("ranked results").
function figSheaf(): Figure {
  const faces: Face[] = [];
  const n = 12;
  const g = 0.42; // spacing along y (toward the front)
  const w = 3.2;
  for (let i = 0; i < n; i++) {
    const y = i * g;
    const x = i * 0.14; // slight horizontal splay
    const h = 0.8 + (n - 1 - i) * 0.4; // grows toward the back
    const tone: Tone = i === 0 ? "bright" : i < 3 ? "mid" : "dim";
    faces.push({
      tone,
      pts: [
        [x, y, 0],
        [x + w, y, 0],
        [x + w, y, h],
        [x, y, h],
      ],
    });
  }
  return { faces };
}

// ── path helpers ────────────────────────────────────────────────────────────

const fmt = (n: number) => n.toFixed(2);

/** Closed path through `pts` with each corner softened to radius `r`. */
function roundedPath(pts: P2[], r: number): string {
  const n = pts.length;
  let d = "";
  for (let i = 0; i < n; i++) {
    const cur = pts[i];
    const prev = pts[(i - 1 + n) % n];
    const next = pts[(i + 1) % n];
    const d1 = Math.hypot(prev[0] - cur[0], prev[1] - cur[1]) || 1;
    const d2 = Math.hypot(next[0] - cur[0], next[1] - cur[1]) || 1;
    const rr = Math.min(r, d1 / 2, d2 / 2);
    const p1: P2 = [
      cur[0] + ((prev[0] - cur[0]) / d1) * rr,
      cur[1] + ((prev[1] - cur[1]) / d1) * rr,
    ];
    const p2: P2 = [
      cur[0] + ((next[0] - cur[0]) / d2) * rr,
      cur[1] + ((next[1] - cur[1]) / d2) * rr,
    ];
    d += `${i === 0 ? "M" : "L"}${fmt(p1[0])} ${fmt(p1[1])} Q${fmt(cur[0])} ${fmt(
      cur[1],
    )} ${fmt(p2[0])} ${fmt(p2[1])} `;
  }
  return d + "Z";
}

function openPath(pts: P2[], close: boolean): string {
  return (
    pts.map((p, i) => `${i === 0 ? "M" : "L"}${fmt(p[0])} ${fmt(p[1])}`).join(" ") +
    (close ? " Z" : "")
  );
}

// ── renderer ────────────────────────────────────────────────────────────────

function FigureSvg({
  figure,
  fill = "background",
}: {
  figure: Figure;
  fill?: "background" | "card";
}) {
  const decos = figure.decos ?? [];
  const dots = figure.dots ?? [];

  // back-to-front so near faces occlude far edges
  const faces = [...figure.faces].sort((a, b) => depth(a.pts) - depth(b.pts));

  // auto-fit viewBox from every projected point
  const all: P2[] = [
    ...figure.faces.flatMap((f) => f.pts),
    ...decos.flatMap((d) => d.pts),
    ...dots.map((d) => d.p),
  ].map(iso);
  const xs = all.map((p) => p[0]);
  const ys = all.map((p) => p[1]);
  const pad = 0.6;
  const minX = Math.min(...xs) - pad;
  const minY = Math.min(...ys) - pad;
  const vw = Math.max(...xs) - minX + pad;
  const vh = Math.max(...ys) - minY + pad;
  const fillClass = fill === "card" ? "fill-card" : "fill-background";

  return (
    <svg
      viewBox={`${fmt(minX)} ${fmt(minY)} ${fmt(vw)} ${fmt(vh)}`}
      className="h-auto w-full"
      fill="none"
      aria-hidden
    >
      {faces.map((f, i) => (
        <path
          key={`f${i}`}
          d={roundedPath(f.pts.map(iso), CORNER)}
          stroke="currentColor"
          strokeWidth={1}
          vectorEffect="non-scaling-stroke"
          className={cn(fillClass, TONE[f.tone])}
        />
      ))}
      {decos.map((s, i) => (
        <path
          key={`s${i}`}
          d={openPath(s.pts.map(iso), s.close !== false)}
          fill="none"
          stroke="currentColor"
          strokeWidth={1}
          strokeLinecap="round"
          vectorEffect="non-scaling-stroke"
          strokeDasharray={s.dash ? "2 3" : undefined}
          className={TONE[s.tone]}
        />
      ))}
      {dots.map((d, i) => {
        const [x, y] = iso(d.p);
        return (
          <circle
            key={`d${i}`}
            cx={x}
            cy={y}
            r={0.07}
            fill="currentColor"
            className={TONE[d.tone]}
          />
        );
      })}
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
  fill,
  className,
}: {
  name: "layers" | "modules" | "sheaf";
  fill?: "background" | "card";
  className?: string;
}) {
  const item = FIGURES.find((f) => f.id === name) ?? FIGURES[0];
  return (
    <figure className={cn("text-foreground", className)}>
      <FigureSvg figure={item.figure} fill={fill} />
    </figure>
  );
}

/** The three figures in a labelled, divided row (matches the reference). */
export function IsoFigures({
  fill,
  className,
}: {
  fill?: "background" | "card";
  className?: string;
}) {
  return (
    <div className={cn("grid gap-px sm:grid-cols-3", className)}>
      {FIGURES.map(({ id, label, figure }) => (
        <div key={id} className="relative px-8 py-12 sm:px-10">
          <span className="absolute left-8 top-8 font-mono text-[11px] uppercase tracking-[0.22em] text-muted-foreground sm:left-10">
            {label}
          </span>
          <div className="mx-auto mt-6 max-w-[15rem] text-foreground">
            <FigureSvg figure={figure} fill={fill} />
          </div>
        </div>
      ))}
    </div>
  );
}
