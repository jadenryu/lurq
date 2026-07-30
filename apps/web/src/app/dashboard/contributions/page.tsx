import { ContributionsFeed } from "@/components/dashboard/contributions-feed";
import { PageHeader } from "@/components/dashboard/page-header";
import { loadContributions } from "@/lib/dashboard-data";

export default async function DashboardContributionsPage() {
  const { data, demo } = await loadContributions();

  return (
    <div>
      <PageHeader
        title="contributions"
        subtitle="Packages you were the first to put on lurq's radar, fetched and scored because you asked."
        demo={demo}
      />

      <div className="mt-8">
        <ContributionsFeed packages={data.packages} />
      </div>
    </div>
  );
}
