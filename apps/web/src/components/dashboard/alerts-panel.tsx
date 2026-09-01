import Link from "next/link";
import { Chip, Panel, PanelHeader } from "@/components/dashboard/panel";
import { relativeTime } from "@/lib/format";
import type { RepoAlert } from "@/lib/lurq-issuer";

/**
 * "What broke lately", the reactive counterpart to the drift table below it.
 *
 * Drift answers a standing question ("how far behind is this repo") and is
 * therefore always on screen. This answers an event ("stripe shipped a major two
 * hours ago and you depend on it"), so it only exists when something happened,
 * and it renders nothing at all when nothing has. A permanently-visible panel
 * saying "no alerts" trains people to stop looking at the one place that is
 * supposed to be worth looking at.
 *
 * The two rows are ordered by consequence, not time: an open range that will
 * swallow the new major at the next install outranks a pinned one that merely
 * fell further behind, because only the first can break a build nobody touched.
 */

/**
 * The distinction the whole feed turns on. A caret range means the repo is now a
 * major behind: bad, static, and the drift table would have said so anyway. An
 * open range means the repo is not behind at all and its next clean install
 * moves it onto the new major unprompted, which no drift number expresses.
 */
function RangeCell({ alert }: { alert: RepoAlert }) {
  if (alert.inRange) {
    return (
      <span title={`${alert.range} already admits ${alert.toVersion}`}>
        <Chip tone="bad">next install takes it</Chip>
      </span>
    );
  }
  return <Chip tone="warn">now a major behind</Chip>;
}

export function AlertsPanel({ alerts }: { alerts: RepoAlert[] }) {
  if (alerts.length === 0) return null;

  const ordered = [...alerts].sort(
    (a, b) => Number(b.inRange) - Number(a.inRange) || b.createdAt.localeCompare(a.createdAt),
  );
  const urgent = ordered.filter((a) => a.inRange).length;

  return (
    <Panel>
      <PanelHeader
        title="breaking releases"
        trailing={
          <span className="font-mono text-xs text-ink-2">
            {urgent > 0 ? `${urgent} will install on their own` : `${alerts.length} to review`}
          </span>
        }
      />
      <ul className="mt-4 space-y-2">
        {ordered.map((alert) => (
          <li
            key={alert.id}
            className="flex flex-wrap items-center gap-x-3 gap-y-1.5 border-t border-edge pt-2 first:border-0 first:pt-0"
          >
            {/* The package is the subject of the alert, so it is the link —
                and it lands on that package's own row in the repo's drift
                table rather than on the repo. The footnote below has always
                said to open a repository for the migration brief; it used to
                leave the actual finding of it as an exercise. */}
            <Link
              href={`/dashboard/repos/${alert.repoId}?q=${encodeURIComponent(alert.packageName)}#deps`}
              className="rounded-[var(--radius-chip)] font-mono text-sm outline-none hover:text-signal focus-visible:ring-2 focus-visible:ring-signal/50"
            >
              {alert.packageName}
              <span className="text-ink-2/60">
                {" "}
                {alert.fromVersion ?? alert.range} → {alert.toVersion}
              </span>
            </Link>
            <RangeCell alert={alert} />
            <Link
              href={`/dashboard/repos/${alert.repoId}`}
              className="rounded-[var(--radius-chip)] font-mono text-xs text-ink-2 outline-none hover:text-signal focus-visible:ring-2 focus-visible:ring-signal/50"
            >
              {alert.repoFullName}
            </Link>
            <span className="ml-auto font-mono text-xs text-ink-2/60">
              {relativeTime(alert.createdAt)}
            </span>
          </li>
        ))}
      </ul>
      <p className="mt-4 text-xs text-ink-2/70">
        Detected when the release landed, not at the next scan. Open a repository for the
        migration brief: which exports the upgrade actually removes.
      </p>
    </Panel>
  );
}
