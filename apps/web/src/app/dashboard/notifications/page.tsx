import type { Metadata } from "next";
import Link from "next/link";
import { AlertsPanel } from "@/components/dashboard/alerts-panel";
import { EmptyState } from "@/components/dashboard/panel";
import { PageHeader } from "@/components/dashboard/page-header";
import { loadAlerts } from "@/lib/dashboard-data";

export const metadata: Metadata = {
  title: "notifications",
  description: "Releases that affect a repo you have connected.",
};

/**
 * The alert feed, given a page of its own.
 *
 * ponytail: NO DELIVERY TOGGLES. The obvious build here is a column of
 * checkboxes — email me on alerts, digest weekly, notify on scan failure — and
 * every one of them would be a control over a sender that does not exist.
 * Resend is wired for exactly one thing in this app, the marketing contact form
 * (app/api/contact/route.ts), and nothing in the backend queues or sends a
 * notification. A stored preference governing nothing is worse than an absent
 * one: it reads as a promise that mail is coming, and the first alert someone
 * misses is one they believed they had subscribed to.
 *
 * Add the toggles in the same commit as the sender, not before.
 *
 * The overview shows this same panel, and deliberately: there it is one card
 * among several and renders nothing when the feed is empty, because a permanent
 * "no alerts" trains people to stop looking. Here the page IS the feed, so an
 * empty state is the honest answer rather than a blank screen.
 */
export default async function DashboardNotificationsPage() {
  const { data: alerts, demo } = await loadAlerts();

  return (
    <div>
      <PageHeader
        title="notifications"
        subtitle="Releases that affect a repo you have connected."
        demo={demo}
      />

      <div className="mt-8">
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
      </div>
    </div>
  );
}
