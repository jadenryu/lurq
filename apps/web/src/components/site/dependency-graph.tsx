/**
 * The hero's background drawing: a dependency graph.
 *
 * The argument for it over a texture is that it is the product's own data
 * model. lurq resolves a graph of packages and returns a verdict per node, so
 * the wallpaper is that graph, drawn the way a dependency tree is actually
 * rendered rather than the way a "network" stock graphic is.
 *
 * Three rules keep it out of stock-graphic territory:
 *
 * 1. Orthogonal routing with rounded elbows, not organic beziers. Beziers
 *    between scattered dots is the shape every AI-generated hero uses.
 * 2. Every node lands on a dot of the matrix behind it. The lattice is 40px and
 *    all coordinates are ≡ 20 (mod 40), which is where `circle at center` puts
 *    the dot in a 40px tile. The graph is drawn *on* the paper, not floating
 *    over it. `.room-graph` in tokens.css keeps the two origins in phase, at
 *    both scales.
 * 3. Coordinates are placed by hand. A generated layout looks generated: even
 *    spacing, no repeated sub-dependency, no node with two parents.
 *
 * Drawn 1:1 in CSS pixels — no viewBox scaling — because a scaled viewBox
 * breaks rule 2. It is wider than the viewport on purpose and the field clips
 * it; the edges are meant to run off.
 */

/** Named so the edge list below reads as a graph rather than as coordinates. */
const N = {
  a: [60, 220],
  b: [220, 140],
  c: [220, 340],
  d: [380, 60],
  e: [380, 260],
  f: [380, 420],
  g: [140, 580],
  h: [300, 660],
  i: [460, 580],
  j: [300, 860],
  k: [420, 780],
  l: [620, 180],
  m: [780, 60],
  n: [660, 900],
  o: [860, 820],
  p: [1020, 940],
  q: [1140, 140],
  r: [1300, 220],
  s: [1460, 140],
  t: [1460, 340],
  u: [1100, 420],
  v: [1260, 500],
  w: [1540, 500],
  x: [1180, 700],
  y: [1380, 780],
  z: [1540, 900],
} as const satisfies Record<string, readonly [number, number]>;

type Node = keyof typeof N;

/**
 * [parent, child, elbow x, pulse delay in seconds].
 *
 * `e` and `u` each have two parents and `k` has two, which is the whole point:
 * a tree where every node has exactly one parent is a diagram of nothing. Those
 * junctions are where two dependents disagree, which is the case lurq exists
 * for.
 *
 * The delays trace one path in from the left edge and out to the right, so the
 * pulse reads as a single resolution walking the graph rather than as several
 * unrelated blinks.
 */
const EDGES: [Node, Node, number, number?][] = [
  ["a", "b", 140, 0],
  ["a", "c", 140],
  ["b", "d", 300],
  ["b", "e", 300, 2.4],
  ["c", "e", 300],
  ["c", "f", 300],
  ["e", "l", 500, 4.8],
  ["l", "m", 700],
  ["l", "q", 860, 7.2],
  ["q", "r", 1220, 9.6],
  ["r", "s", 1380],
  ["r", "t", 1380, 12],
  ["f", "i", 420],
  ["g", "h", 220, 15],
  ["h", "i", 380, 17.4],
  ["g", "j", 220],
  ["j", "k", 380],
  ["h", "k", 380],
  ["k", "n", 540],
  ["n", "o", 780],
  ["o", "p", 940],
  ["p", "y", 1180],
  ["i", "u", 780, 19.8],
  ["u", "r", 1180],
  ["u", "v", 1180, 22.2],
  ["v", "w", 0],
  ["v", "x", 1220],
  ["x", "y", 1300],
  ["y", "z", 1460],
  ["m", "s", 1100],
];

/**
 * Out from the parent, across at `mx`, into the child, with quadratic corners.
 * Same-row edges are a straight run and skip the elbow entirely.
 */
function elbow(from: readonly [number, number], to: readonly [number, number], mx: number) {
  const [x1, y1] = from;
  const [x2, y2] = to;
  if (y1 === y2) return `M${x1} ${y1}H${x2}`;
  const r = 12;
  const dy = Math.sign(y2 - y1);
  const dx1 = Math.sign(mx - x1);
  const dx2 = Math.sign(x2 - mx);
  return (
    `M${x1} ${y1}H${mx - dx1 * r}` +
    `Q${mx} ${y1} ${mx} ${y1 + dy * r}` +
    `V${y2 - dy * r}` +
    `Q${mx} ${y2} ${mx + dx2 * r} ${y2}` +
    `H${x2}`
  );
}

/**
 * The two nodes carrying a verdict. Colour states an outcome here the same way
 * it does everywhere else on this site, so it stays at two, and `--conflict`
 * sits on a node with two parents, which is the only place a conflict can come
 * from.
 *
 * Both have to sit outside the hero pocket or the mask eats them, and above the
 * 900px fold or nobody sees them without scrolling: `k` low left, `x` low
 * right. `k` sits a row higher than its siblings for exactly that reason. The
 * other two-parent nodes (`e`, `r`) are behind the headline.
 */
const VERDICTS: { at: Node; kind: "held" | "conflict" }[] = [
  { at: "k", kind: "conflict" },
  { at: "x", kind: "held" },
];

export function DependencyGraph() {
  return (
    <svg
      aria-hidden
      className="room-graph"
      width={1600}
      height={1000}
      viewBox="0 0 1600 1000"
      fill="none"
    >
      {EDGES.map(([from, to, mx, delay]) => {
        const d = elbow(N[from], N[to], mx);
        return (
          <g key={`${from}${to}`}>
            <path className="room-graph-edge" d={d} />
            {/* The travelling light is a second copy of the same path with a
                short dash walked along it. pathLength normalises every edge to
                1000 units so one dash length reads the same on a 100px hop and
                on the 640px span behind the headline. */}
            {delay === undefined ? null : (
              <path
                className="room-graph-pulse"
                d={d}
                pathLength={1000}
                style={{ animationDelay: `${delay}s` }}
              />
            )}
          </g>
        );
      })}

      {/* Nodes last so an edge never crosses over one. Filled with --ground, so
          a line passing behind a node is occluded by it the way it would be on
          a drawing. */}
      {(Object.keys(N) as Node[]).map((k) => (
        <circle key={k} className="room-graph-node" cx={N[k][0]} cy={N[k][1]} r={3.5} />
      ))}

      {VERDICTS.map(({ at, kind }) => (
        <circle
          key={at}
          className="room-graph-verdict"
          data-verdict={kind}
          cx={N[at][0]}
          cy={N[at][1]}
          r={9}
        />
      ))}
    </svg>
  );
}
