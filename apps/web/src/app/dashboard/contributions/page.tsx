import { auth } from "@clerk/nextjs/server";
import { ContributionsFeed } from "@/components/dashboard/contributions-feed";
import { fetchContributions, type DashboardContribution } from "@/lib/lurq-issuer";

export default async function DashboardContributionsPage() {
  const { userId } = await auth();

  // Degrades independently — an MCP-server hiccup shouldn't 500 the page.
  let total = 0;
  let packages: DashboardContribution[] = [];
  try {
    if (userId) {
      const data = await fetchContributions(userId);
      total = data.total;
      packages = data.packages;
    }
  } catch {
    total = 0;
    packages = [];
  }

  return (
    <div>
      <h1 className="font-heading text-2xl font-medium lowercase tracking-tight md:text-3xl">
        contributions
      </h1>
      <p className="mt-3 text-muted-foreground">
        Packages you were the first to put on lurq&apos;s radar — fetched and scored because you
        asked.
      </p>

      <div className="panel-lit mt-10 rounded-[var(--radius-xl)] border border-border p-5 md:p-7">
        <p className="font-mono text-xs uppercase tracking-[0.16em] text-muted-foreground/70">
          {total} package{total === 1 ? "" : "s"}
        </p>
        <div className="mt-5">
          <ContributionsFeed packages={packages} />
        </div>
      </div>
    </div>
  );
}
