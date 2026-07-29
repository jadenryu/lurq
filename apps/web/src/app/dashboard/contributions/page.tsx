import { auth } from "@clerk/nextjs/server";
import { ContributionsFeed } from "@/components/dashboard/contributions-feed";
import { PageHeader } from "@/components/dashboard/page-header";
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
      <PageHeader
        title="contributions"
        subtitle="Packages you were the first to put on lurq's radar — fetched and scored because you asked."
      />

      <div className="panel-lit mt-8 rounded-[var(--radius-xl)] border border-border p-5 md:p-7">
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
