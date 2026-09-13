import type { Metadata } from "next";
import Link from "next/link";
import { AlertsPanel } from "@/components/dashboard/alerts-panel";
import { EmptyState } from "@/components/dashboard/panel";
import { PageBody, PageHeader } from "@/components/dashboard/page-header";
import { DigestPrompt } from "@/components/dashboard/notifications-form";
import { loadAlerts, loadNotificationPreferences } from "@/lib/dashboard-data";

export const metadata: Metadata = {
  title: "notifications",
  description: "Releases that affect a repo you have connected.",
};

/**
 * The alert feed, given a page of its own.
 *
 * Delivery settings live on the preferences page, added in the same change as the
 * sender (src/notify). This page asks one question in context — the weekly
 * summary opt-in — because the moment someone is reading alerts is the moment the
 * offer makes sense; urgent alerts are on by default and need no prompt.
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
        {email.emailConfigured && !email.weeklyDigest && <DigestPrompt demo={demo} />}

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
      </PageBody>
    </div>
  );
}
