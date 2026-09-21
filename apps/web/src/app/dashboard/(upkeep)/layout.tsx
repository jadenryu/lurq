import type { ReactNode } from "react";
import { UpkeepTabs } from "@/components/dashboard/upkeep-tabs";
import { loadMcpServers, loadRuns } from "@/lib/dashboard-data";

/**
 * One hub for the upkeep layer.
 *
 * These three pages answer one question in three places — what do my agents and
 * my repositories depend on, and is it still what I think it is. They had three
 * rows in the rail, so keeping a repository current and keeping an MCP contract
 * honest looked like unrelated products, and the log of what the autopilot did
 * was a separate destination from the switch that arms it.
 *
 * A route group, so nothing moves: `(upkeep)` is parenthesised and Next leaves
 * it out of the path. /dashboard/repos, /dashboard/runs and /dashboard/mcp are
 * the same URLs they were, which matters because they are linked from the docs,
 * from `lurq setup`, and from notification emails already in people's inboxes.
 * The grouping is navigation, and navigation is not a reason to break a link.
 */
export default async function UpkeepLayout({ children }: { children: ReactNode }) {
  // Both are `cache()`d loaders the tabs' own pages already call, so this costs
  // one request each on the tab that does not, and nothing on the tab that does.
  const [{ data: runs }, { data: mcp }] = await Promise.all([loadRuns(), loadMcpServers()]);

  return (
    <div>
      <UpkeepTabs
        counts={{
          runs: runs.filter((run) => run.status === "pr_open").length,
          mcp: mcp.events.filter((event) => !event.acknowledgedAt).length,
        }}
      />
      {children}
    </div>
  );
}
