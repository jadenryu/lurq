import { PageHeader } from "@/components/dashboard/page-header";
import { RangeTabs, parseDays } from "@/components/dashboard/range-tabs";
import { UsagePanel } from "@/components/dashboard/usage-panel";
import { loadUsage } from "@/lib/dashboard-data";

export default async function DashboardUsagePage(props: PageProps<"/dashboard/usage">) {
  const days = parseDays((await props.searchParams).days);
  const { data: usage, demo } = await loadUsage(days);

  return (
    <div>
      <PageHeader
        title="usage"
        subtitle="How often your agents call lurq, by day and by tool."
        demo={demo}
        action={<RangeTabs active={days} basePath="/dashboard/usage" />}
      />

      <div className="mt-8">
        <UsagePanel usage={usage} days={days} />
      </div>
    </div>
  );
}
