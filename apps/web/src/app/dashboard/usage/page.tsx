import { auth } from "@clerk/nextjs/server";
import { UsagePanel } from "@/components/dashboard/usage-panel";
import { fetchUsage, type DashboardUsage } from "@/lib/lurq-issuer";

export default async function DashboardUsagePage() {
  const { userId } = await auth();

  // Degrades independently — an MCP-server hiccup shouldn't 500 the page.
  let usage: DashboardUsage = { today: 0, series: [], byTool: [] };
  try {
    if (userId) usage = await fetchUsage(userId);
  } catch {
    usage = { today: 0, series: [], byTool: [] };
  }

  return (
    <div>
      <h1 className="font-heading text-2xl font-medium lowercase tracking-tight md:text-3xl">
        usage
      </h1>
      <p className="mt-3 text-muted-foreground">
        How often your agents call lurq — by day, and by tool.
      </p>

      <div className="mt-10">
        <UsagePanel usage={usage} />
      </div>
    </div>
  );
}
