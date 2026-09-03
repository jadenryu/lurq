import { ActivityFeed } from "@/components/dashboard/activity-feed";
import { PageBody, PageHeader } from "@/components/dashboard/page-header";
import { loadOutcomes } from "@/lib/dashboard-data";

export default async function DashboardActivityPage() {
  const { data: outcomes, demo } = await loadOutcomes();

  return (
    <div>
      <PageHeader
        title="activity"
        subtitle="Packages lurq has recommended for you, and what happened after."
        demo={demo}
      />

      <PageBody>
        <ActivityFeed outcomes={outcomes} />
      </PageBody>
    </div>
  );
}
