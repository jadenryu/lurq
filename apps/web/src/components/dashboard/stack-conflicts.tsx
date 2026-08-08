import { Chip, EmptyState, Panel, PanelHeader } from "@/components/dashboard/panel";
import type { StackConflict } from "@/lib/lurq-issuer";

/**
 * Dependencies that disagree with each other, rather than with time.
 *
 * Every other panel on this page measures a repo against the calendar — how far
 * behind, what has an advisory. This one measures it against itself: two plugins
 * that want different majors of the same peer, or engine ranges with no common
 * Node. Those are the findings that turn an upgrade into a week of work, and
 * nothing in a drift number predicts them.
 *
 * The heading says "at latest versions" everywhere because that is what was
 * measured — the check runs over what the migration brief is proposing, not over
 * what is installed today. A panel that let the reader assume otherwise would be
 * reporting a conflict they cannot reproduce locally.
 */
export function StackConflictsPanel({ conflicts }: { conflicts: StackConflict[] | null }) {
  if (!conflicts) {
    return (
      <EmptyState title="Compatibility not checked">
        This repository was last scanned before the compatibility check existed. Rescan it to see
        whether its dependencies agree on their shared peers and Node versions.
      </EmptyState>
    );
  }

  return (
    <div className="space-y-4">
      <PanelHeader
        title="compatibility at latest"
        trailing={
          <span className="font-mono text-xs text-muted-foreground">
            {conflicts.length === 0
              ? "no conflicts"
              : `${conflicts.length} conflict${conflicts.length === 1 ? "" : "s"}`}
          </span>
        }
      />

      <p className="max-w-2xl text-sm leading-relaxed text-muted-foreground">
        Peer-dependency and Node engine disagreements across your dependencies, evaluated at the
        versions the upgrades above would land on. These are what make an upgrade stall: not that a
        package is old, but that two of them cannot both be satisfied.
      </p>

      {conflicts.length === 0 ? (
        <Panel padding="tight">
          <p className="text-sm text-muted-foreground">
            Every declared peer range and engine range has a common solution at latest. Packages
            that declare no peers contribute no constraints, so this is a check that passed, not a
            guarantee that no package was missing metadata.
          </p>
        </Panel>
      ) : (
        <div className="space-y-3">
          {conflicts.map((conflict, i) => (
            <Panel key={`${conflict.source}-${conflict.packages.join("+")}-${i}`} padding="tight">
              <div className="flex flex-wrap items-center gap-2">
                <Chip tone={conflict.source === "peer-deps" ? "bad" : "warn"}>
                  {conflict.source === "peer-deps" ? "peer" : conflict.source}
                </Chip>
                {conflict.packages.map((name) => (
                  <code
                    key={name}
                    className="rounded-[var(--radius-chip)] border border-border px-1.5 py-0.5 font-mono text-xs"
                  >
                    {name}
                  </code>
                ))}
              </div>
              <p className="mt-2 text-sm leading-relaxed">{conflict.detail}</p>
              {conflict.requirement && (
                <p className="mt-1 font-mono text-xs text-muted-foreground">
                  {conflict.requirement.peer}
                  {" · wants "}
                  {conflict.requirement.range}
                  {" · stack has "}
                  {conflict.requirement.resolved ?? "no pinned version"}
                </p>
              )}
            </Panel>
          ))}
        </div>
      )}
    </div>
  );
}
