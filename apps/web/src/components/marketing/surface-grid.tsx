"use client";

import { useState } from "react";
import { usageDiff } from "@/lib/marketing-data";
import { cn } from "@/lib/utils";

/**
 * The API surface as a grid — one square per export, in the old version's
 * declaration order with the new exports appended.
 *
 * A list of sixteen removed symbols is something nobody reads. The same
 * information as 193 squares shows the *shape* of a breaking major at a glance:
 * how much of the surface moved, and whether the movement is scattered through
 * the API or concentrated in one corner. Names come after.
 */

type Cell = (typeof usageDiff.cells)[number];

/**
 * A changed or renamed export is a removal and an addition inside one symbol, so
 * its square is split on the diagonal rather than given a colour of its own. Set
 * as an inline style, not an arbitrary Tailwind class: a gradient carrying CSS
 * variables is exactly the kind of value that silently fails to compile.
 */
const SPLIT =
  "linear-gradient(135deg, var(--conflict) 0 50%, var(--verified) 50% 100%)";

const STATUS_STYLE: Record<string, string> = {
  unchanged: "bg-ink/[0.14]",
  removed: "bg-conflict",
  added: "bg-verified",
  changed: "",
  renamed: "",
};

export function SurfaceGrid() {
  const { cells, counts, unchanged, package: pkg, fromVersion, toVersion } = usageDiff;
  const [hovered, setHovered] = useState<Cell | null>(null);

  const changedTotal = counts.removed + counts.added + counts.changed + counts.renamed;

  return (
    <div>
      <p className="t-data flex flex-wrap gap-x-4 gap-y-1 text-ink-soft">
        <span className="text-conflict">{counts.removed} removed</span>
        <span>{counts.renamed} renamed</span>
        <span>{counts.changed} changed</span>
        <span className="text-verified">{counts.added} added</span>
        <span className="text-ink-soft/55">{unchanged} unchanged</span>
      </p>

      <div
        role="img"
        aria-label={`${pkg} ${fromVersion} to ${toVersion}: ${counts.removed} exports removed, ${counts.renamed} renamed, ${counts.changed} changed signature, ${counts.added} added, ${unchanged} unchanged.`}
        className="mt-5 grid justify-start gap-[3px]"
        style={{ gridTemplateColumns: "repeat(auto-fill, 12px)" }}
        onMouseLeave={() => setHovered(null)}
      >
        {cells.map((cell) => {
          const split = cell.status === "changed" || cell.status === "renamed";
          return (
            <span
              key={`${cell.name}-${cell.status}`}
              title={`${cell.name} · ${cell.kind} · ${cell.status}`}
              onMouseEnter={() => setHovered(cell)}
              className={cn(
                "size-3 rounded-[1px]",
                STATUS_STYLE[cell.status],
                hovered?.name === cell.name &&
                  "outline outline-1 outline-offset-1 outline-mark",
              )}
              style={split ? { background: SPLIT } : undefined}
            />
          );
        })}
      </div>

      {/* Fixed-height readout so hovering can't reflow the section. */}
      <p className="t-data mt-4 h-5 text-ink-soft">
        {hovered ? (
          <>
            <span className="text-ink">{hovered.name}</span>
            <span className="mx-2 text-rule">·</span>
            {hovered.kind}
            <span className="mx-2 text-rule">·</span>
            <span
              className={
                hovered.status === "removed"
                  ? "text-conflict"
                  : hovered.status === "added"
                    ? "text-verified"
                    : "text-ink-soft"
              }
            >
              {hovered.status}
            </span>
          </>
        ) : (
          <span className="text-ink-soft/55">
            {cells.length} exports · hover a square to name it
          </span>
        )}
      </p>

      <details className="mt-6 border-t border-rule pt-4">
        <summary className="t-data cursor-pointer text-ink-soft transition-colors duration-[120ms] hover:text-mark">
          list all {changedTotal} changes
        </summary>
        <ul className="mt-3 columns-2 gap-6 sm:columns-3">
          {cells
            .filter((c) => c.status !== "unchanged")
            .map((c) => (
              <li
                key={`${c.name}-${c.status}`}
                className="t-data break-inside-avoid text-ink-soft"
              >
                <span
                  aria-hidden
                  className={
                    c.status === "removed"
                      ? "pr-1.5 text-conflict"
                      : c.status === "added"
                        ? "pr-1.5 text-verified"
                        : "pr-1.5 text-ink-soft/60"
                  }
                >
                  {c.status === "removed"
                    ? "−"
                    : c.status === "added"
                      ? "+"
                      : c.status === "renamed"
                        ? "~"
                        : "!"}
                </span>
                {c.name}
              </li>
            ))}
        </ul>
      </details>
    </div>
  );
}
