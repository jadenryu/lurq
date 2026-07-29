import { auth } from "@clerk/nextjs/server";
import { ActivityFeed } from "@/components/dashboard/activity-feed";
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
      <h1 className="font-heading text-2xl font-medium lowercase tracking-tight md:text-3xl">
        activity
      </h1>
      <p className="mt-3 text-muted-foreground">
        Packages lurq has recommended for you, and what happened after.
      </p>

      <div className="panel-lit mt-10 rounded-[var(--radius-xl)] border border-border p-5 md:p-7">
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
