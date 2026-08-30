import { ActivityMap } from "@/components/dashboard/activity-map";
import { PageHeader } from "@/components/dashboard/page-header";
import { RangeTabs, parseDays } from "@/components/dashboard/range-tabs";
import { UsagePanel } from "@/components/dashboard/usage-panel";
import { loadUsage } from "@/lib/dashboard-data";
import { loadSettings } from "@/lib/user-settings";

/** The year map is fixed at a year on purpose — it is a calendar, not a window,
 *  so the range tabs govern the trend and per-tool cards below it and nothing
 *  else. Two reads rather than one because `byTool` is aggregated server-side
 *  per window and cannot be sliced out of the longer series. */
const YEAR = 365;

export default async function DashboardUsagePage(props: PageProps<"/dashboard/usage">) {
  // The user's preference is the fallback, never an override: an explicit
  // `?days=` in the URL is someone following a link that meant a specific
  // window, and a stored default that quietly rewrote it would break every
  // shared link into this page.
  const [{ defaultRangeDays }, searchParams] = await Promise.all([
    loadSettings(),
    props.searchParams,
  ]);
  const days = parseDays(searchParams.days, defaultRangeDays);
  const [{ data: usage, demo }, { data: year }] = await Promise.all([
    loadUsage(days),
    loadUsage(YEAR),
  ]);

  return (
    <div>
      <PageHeader
        title="credits"
        subtitle="How often your agents call lurq, by day and by tool."
        demo={demo}
        action={<RangeTabs active={days} basePath="/dashboard/usage" />}
      />

      <div className="mt-8 space-y-6">
        <ActivityMap series={year.series} />
        <UsagePanel usage={usage} days={days} />
      </div>
    </div>
  );
}
