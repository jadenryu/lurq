import { Panel, PanelHeader, eyebrow } from "@/components/dashboard/panel";
import { RULE_LABEL } from "@/components/dashboard/conformance-panel";
import type { PolicyChange, PolicyDecision } from "@/lib/lurq-issuer";
import { cn } from "@/lib/utils";

/**
 * What the policy actually did: the packages agents reached for and were refused
 * (or warned about, in warn mode), and who changed the rules.
 *
 * The conformance panel answers "what does my existing code break". This answers
 * the question a rule raises the day after it is saved, "is it catching
 * anything?". Without it, warn mode is a switch with no readout, and a policy that
 * is quietly saving a team from bad installs looks identical to one doing nothing.
 */

/** `key lurq_live_…` reads as a CLI push, which is what it was. */
function actorLabel(actor: string): string {
  return actor === "dashboard" ? "dashboard" : `CLI push · ${actor.replace(/^key /, "")}`;
}

export function PolicyActivityPanel({
  days,
  decisions,
  changes,
}: {
  days: number;
  decisions: PolicyDecision[];
  changes: PolicyChange[];
}) {
  const total = (action: PolicyDecision["action"]) =>
    decisions.filter((d) => d.action === action).reduce((sum, d) => sum + d.count, 0);

  return (
    <Panel>
      <PanelHeader
        title="what the policy caught"
        trailing={
          <span className="text-[11px] font-medium uppercase tracking-[0.04em] text-ink-3">
            last {days} days · {total("blocked")} blocked · {total("warned")} warned
          </span>
        }
      />

      {decisions.length === 0 ? (
        <p className="mt-3 text-sm leading-relaxed text-ink-2">
          Nothing refused or warned about yet. Each time an agent reaches for a package your
          rules would refuse, it shows up here.
        </p>
      ) : (
        <ul className="mt-3 divide-y divide-edge border-y border-edge">
          {decisions.map((d) => (
            <li
              key={`${d.packageName}-${d.rule}-${d.action}`}
              className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1 py-2"
            >
              <span className="font-mono text-xs text-ink">{d.packageName}</span>
              <span className="rounded-sm bg-muted px-1.5 py-0.5 font-mono text-[0.65rem] uppercase tracking-[0.12em] text-ink-3">
                {RULE_LABEL[d.rule] ?? d.rule}
              </span>
              <span
                className={cn(
                  "font-mono text-[0.7rem]",
                  d.action === "blocked" ? "text-bad" : "text-warn",
                )}
              >
                {d.action}
              </span>
              <span className="ml-auto font-mono text-[0.7rem] tabular-nums text-ink-3">
                {d.count}× · last {d.lastDay}
              </span>
            </li>
          ))}
        </ul>
      )}

      <p className={cn(eyebrow, "mt-6")}>recent changes</p>
      {changes.length === 0 ? (
        <p className="mt-2 text-sm text-ink-2">No changes recorded yet.</p>
      ) : (
        <ol className="mt-2 space-y-3">
          {changes.slice(0, 5).map((change) => (
            <li key={`${change.at}-${change.actor}`}>
              <p className="font-mono text-[0.7rem] text-ink-3">
                {change.at.slice(0, 16).replace("T", " ")} UTC · {actorLabel(change.actor)}
              </p>
              <ul className="mt-1 space-y-0.5">
                {change.changes.length === 0 ? (
                  <li className="font-mono text-xs text-ink-3">saved with no rule changes</li>
                ) : (
                  change.changes.map((line) => (
                    <li
                      key={line}
                      className={cn(
                        "font-mono text-xs",
                        line.startsWith("+") ? "text-ink" : "text-ink-3",
                      )}
                    >
                      {line}
                    </li>
                  ))
                )}
              </ul>
            </li>
          ))}
        </ol>
      )}
      <p className={cn(eyebrow, "mt-4")}>
        The same record is in the terminal: <span className="font-mono">lurq policy log</span>{" "}
        and <span className="font-mono">lurq policy history</span>.
      </p>
    </Panel>
  );
}
