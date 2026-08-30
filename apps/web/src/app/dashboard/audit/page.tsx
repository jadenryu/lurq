import type { Metadata } from "next";
import { PageHeader } from "@/components/dashboard/page-header";
import { Chip, EmptyState, Panel } from "@/components/dashboard/panel";
import { loadAuditLog, type AuditEvent } from "@/lib/audit";
import { relativeTime } from "@/lib/format";

export const metadata: Metadata = {
  title: "audit log",
  description: "Everything that happened in this workspace, newest first.",
};

/** The kind is the scan column: three words, fixed width, so the eye can filter
 *  down the left edge without reading a single summary. */
const KIND_LABEL: Record<AuditEvent["kind"], string> = {
  key: "key",
  scan: "scan",
  alert: "alert",
};

function Row({ event }: { event: AuditEvent }) {
  return (
    <li className="flex flex-wrap items-baseline gap-x-3 gap-y-1 border-b border-edge py-3 last:border-b-0">
      <span className="w-12 shrink-0 font-mono text-[11px] uppercase tracking-wide text-ink-3">
        {KIND_LABEL[event.kind]}
      </span>
      <span className="min-w-0 flex-1 text-sm text-foreground">{event.summary}</span>
      {event.tone !== "neutral" && (
        <Chip tone={event.tone === "bad" ? "bad" : "warn"}>
          {event.tone === "bad" ? "action needed" : "review"}
        </Chip>
      )}
      {/* Relative, with the exact stamp on hover. A log is read for "what
          changed recently", which relative time answers directly; the absolute
          time is what you need once you are correlating with something else,
          and that is a deliberate act worth a hover. */}
      <time
        dateTime={event.at}
        title={new Date(event.at).toISOString()}
        className="shrink-0 font-mono text-[11px] text-ink-3"
      >
        {relativeTime(event.at)}
      </time>
      {event.detail && (
        <p className="w-full pl-[3.75rem] text-sm text-muted-foreground">{event.detail}</p>
      )}
    </li>
  );
}

export default async function DashboardAuditPage() {
  const { events, demo } = await loadAuditLog();

  return (
    <div>
      <PageHeader
        title="audit log"
        subtitle="Everything that happened in this workspace, newest first."
        demo={demo}
      />

      <div className="mt-8 space-y-4">
        {events.length === 0 ? (
          <EmptyState title="nothing logged yet">
            Keys you create, repositories lurq scans, and releases that affect them all land here.
          </EmptyState>
        ) : (
          <Panel padding="tight">
            <ul>
              {events.map((event) => (
                <Row key={event.id} event={event} />
              ))}
            </ul>
          </Panel>
        )}

        {/* Says what the log does not cover, on the page rather than in a
            comment. A log that silently omits a category is worse than no log:
            it is read as "this did not happen". */}
        <p className="text-[12px] leading-relaxed text-ink-3">
          Covers API keys, repository scans and release alerts — every event lurq already stores a
          timestamp for. Policy edits and preference changes are not recorded yet, so they do not
          appear here.
        </p>
      </div>
    </div>
  );
}
