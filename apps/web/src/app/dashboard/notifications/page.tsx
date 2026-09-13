import type { Metadata } from "next";
import Link from "next/link";
import { AlertsPanel } from "@/components/dashboard/alerts-panel";
import { EmptyState } from "@/components/dashboard/panel";
import { PageBody, PageHeader } from "@/components/dashboard/page-header";
import { NotificationsForm } from "@/components/dashboard/notifications-form";
import { loadAlerts, loadNotificationPreferences } from "@/lib/dashboard-data";

export const metadata: Metadata = {
  title: "notifications",
  description: "Releases that affect a repo you have connected.",
};

/**
 * The alert feed, given a page of its own.
 *
 * Email settings live here, under the feed they govern, added in the same change
 * as the sender (src/notify). Urgent alerts are on by default; the weekly summary
 * is opt-in, and is also offered in context on the MCP servers page.
 *
 * The overview shows this same panel, and deliberately: there it is one card
 * among several and renders nothing when the feed is empty, because a permanent
 * "no alerts" trains people to stop looking. Here the page IS the feed, so an
 * empty state is the honest answer rather than a blank screen.
 */
export default async function DashboardNotificationsPage() {
  const [{ data: alerts, demo }, { data: email }] = await Promise.all([loadAlerts(), loadNotificationPreferences()]);

  return (
    <div>
      <PageHeader
        title="notifications"
        subtitle="Releases that affect a repo you have connected."
        demo={demo}
      />

      <PageBody>
        {alerts.length === 0 ? (
          <EmptyState
            title="nothing to report"
            action={
              <Link href="/dashboard/repos" className="underline underline-offset-4">
                connect a repository
              </Link>
            }
          >
            An alert lands here when a package one of your repos depends on ships a major.
            Connect a repository and lurq will watch its manifests.
          </EmptyState>
        ) : (
          <AlertsPanel alerts={alerts} />
        )}

        <NotificationsForm {...email} demo={demo} />
      </PageBody>
    </div>
  );
}
