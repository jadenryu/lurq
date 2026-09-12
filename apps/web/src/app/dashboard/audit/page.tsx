import type { Metadata } from "next";
import { PageBody, PageHeader } from "@/components/dashboard/page-header";
import { AuditFeed } from "@/components/dashboard/audit-feed";
import { loadAuditLog } from "@/lib/audit";

export const metadata: Metadata = {
  title: "audit log",
  description: "Everything that happened in this workspace, newest first.",
};

export default async function DashboardAuditPage() {
  const { events, demo, readAt } = await loadAuditLog();

  return (
    <div>
      <PageHeader
        title="audit log"
        subtitle="Everything that happened in this workspace, newest first."
        demo={demo}
      />

      <PageBody>
        {/* The clock travels with the log (see lib/audit.ts): reading it in a
            component — server or client — is impure in render, and would hand
            the first paint and every re-render slightly different cutoffs. */}
        <AuditFeed events={events} now={readAt} />

        {/* Says what the log does not cover, on the page rather than in a
            comment. A log that silently omits a category is worse than no log:
            it is read as "this did not happen". */}
        <p className="text-[12px] leading-relaxed text-ink-3">
          Covers API keys, repository scans and release alerts — every event lurq already stores a
          timestamp for. Policy edits and preference changes are not recorded yet, so they do not
          appear here.
        </p>
      </PageBody>
    </div>
  );
}
