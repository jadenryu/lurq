import { provenance } from "@/lib/marketing-data";

/**
 * The ingestion pipeline: ten upstream endpoints converging through the sync into
 * the index, and out to the agent that asked.
 *
 * Same ten facts the list held, one glance instead of ten lines. Drawn as SVG so
 * the hairlines stay hairlines at any zoom. It does not animate: dots travelling
 * the paths looked like throughput but told you nothing you couldn't already see.
 */

// The viewBox is sized to roughly the width the section renders at, so the 11px
// labels land at 11px instead of being scaled down into illegibility.
const W = 1000;
const ROW_H = 30;
const TOP = 24;

const LABEL_RIGHT = 236; // right edge of the source labels
const FAN_X = 252; // where the curves start
const SYNC_X = 500;
const INDEX_X = 700;
const AGENT_X = 908;

export function Pipeline() {
  const sources = provenance.sources;
  const height = TOP * 2 + sources.length * ROW_H;
  const midY = TOP + (sources.length * ROW_H) / 2 - ROW_H / 2;

  const paths = sources.map((_, i) => {
    const y = TOP + i * ROW_H;
    const cx = (FAN_X + SYNC_X) / 2;
    return `M ${FAN_X} ${y} C ${cx} ${y}, ${cx} ${midY}, ${SYNC_X} ${midY}`;
  });

  return (
    <figure className="m-0">
      <svg
        viewBox={`0 0 ${W} ${height}`}
        className="w-full"
        role="img"
        aria-label={`Ten upstream endpoints — ${sources
          .map((s) => s.name)
          .join(", ")} — feed a daily sync, which writes the index the agent reads.`}
      >
        {/* the converging paths */}
        {paths.map((d, i) => (
          <path
            key={`p${i}`}
            d={d}
            fill="none"
            stroke="var(--rule)"
            strokeWidth={1}
            vectorEffect="non-scaling-stroke"
          />
        ))}

        {/* sync → index → agent */}
        <path
          d={`M ${SYNC_X} ${midY} L ${INDEX_X} ${midY}`}
          stroke="var(--rule)"
          strokeWidth={1}
          vectorEffect="non-scaling-stroke"
        />
        <path
          d={`M ${INDEX_X} ${midY} L ${AGENT_X} ${midY}`}
          stroke="var(--rule)"
          strokeWidth={1}
          vectorEffect="non-scaling-stroke"
        />

        {/* source labels */}
        {sources.map((s, i) => {
          const y = TOP + i * ROW_H;
          return (
            <g key={s.name}>
              <text
                x={LABEL_RIGHT}
                y={y - 4}
                textAnchor="end"
                className="fill-ink font-mono text-[11px]"
              >
                {s.name}
              </text>
              <text
                x={LABEL_RIGHT}
                y={y + 10}
                textAnchor="end"
                className="fill-ink-soft font-mono text-[10px]"
              >
                {s.short}
              </text>
              <circle cx={FAN_X} cy={y} r={2} className="fill-rule" />
            </g>
          );
        })}

        {/* the three nodes */}
        <Node x={SYNC_X} y={midY} label="daily sync" />
        <Node x={INDEX_X} y={midY} label="the index" strong />
        <Node x={AGENT_X} y={midY} label="your agent" anchor="end" />
      </svg>
      <figcaption className="t-label mt-4">
        {sources.length} upstream endpoints · one sync a day · every answer stamped with
        when it was read
      </figcaption>
    </figure>
  );
}

function Node({
  x,
  y,
  label,
  strong = false,
  anchor = "middle",
}: {
  x: number;
  y: number;
  label: string;
  strong?: boolean;
  anchor?: "middle" | "end";
}) {
  return (
    <g>
      <circle
        cx={x}
        cy={y}
        r={strong ? 6 : 4}
        className={strong ? "fill-ink" : "fill-paper stroke-ink"}
        strokeWidth={1}
      />
      <text
        x={anchor === "end" ? x - 12 : x}
        y={anchor === "end" ? y + 4 : y - 16}
        textAnchor={anchor}
        className="fill-ink font-mono text-[11px]"
      >
        {label}
      </text>
    </g>
  );
}
