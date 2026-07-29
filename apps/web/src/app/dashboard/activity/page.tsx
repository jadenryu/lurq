import { auth } from "@clerk/nextjs/server";
import { ActivityFeed } from "@/components/dashboard/activity-feed";
import { PageHeader } from "@/components/dashboard/page-header";
import { fetchOutcomes, type DashboardOutcome } from "@/lib/lurq-issuer";

export default async function DashboardActivityPage() {
  const { userId } = await auth();

  let outcomes: DashboardOutcome[] = [];
  try {
    outcomes = userId ? await fetchOutcomes(userId) : [];
  } catch {
    outcomes = [];
  }

  return (
    <div>
      <PageHeader
        title="activity"
        subtitle="Packages lurq has recommended for you, and what happened after."
      />

      <div className="panel-lit mt-8 rounded-[var(--radius-xl)] border border-border p-5 md:p-7">
        <p className="font-mono text-xs uppercase tracking-[0.16em] text-muted-foreground/70">
          {outcomes.length} recommendation{outcomes.length === 1 ? "" : "s"}
        </p>
        <div className="mt-5">
          <ActivityFeed outcomes={outcomes} />
        </div>
      </div>
    </div>
  );
}
