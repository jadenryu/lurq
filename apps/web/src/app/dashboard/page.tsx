import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";
import { GettingStarted } from "@/components/dashboard/getting-started";
import { OnboardingPanel } from "@/components/dashboard/onboarding-panel";
import { OverviewPanel } from "@/components/dashboard/overview-panel";
import { PageHeader } from "@/components/dashboard/page-header";
import { loadOverview } from "@/lib/dashboard-data";

const WINDOW_DAYS = 30;

export default async function DashboardOverviewPage() {
  const { data, demo, failed } = await loadOverview(WINDOW_DAYS);

  const activeKeys = data.keys.filter((k) => !k.revokedAt);
  const calls = data.usage.series.reduce((s, p) => s + p.count, 0);

  // Nothing to chart, nothing to list — either a genuinely fresh account, or a
  // read that failed and therefore also has nothing to show. Both get the setup
  // path: an empty chart frame and four tiles reading `0` tell that person less
  // than one page explaining how to produce data does, and a first-time visitor
  // should never be greeted with a connection error. `failed` is logged in
  // dashboard-data so an outage is still traceable.
  const isNew =
    failed || (calls === 0 && data.outcomes.length === 0 && data.contributions.total === 0);

  // Has a key but has never used it — the one case where the nudge is the missing
  // piece rather than the whole story.
  const showOnboarding = !isNew && activeKeys.length > 0 && activeKeys.every((k) => !k.lastUsedAt);

  return (
    <div>
      <PageHeader
        title="overview"
        subtitle="Your index activity at a glance."
        demo={demo}
        action={
          <Link href="/dashboard/keys" className={buttonVariants({ variant: "outline" })}>
            Manage keys
          </Link>
        }
      />

      <div className="mt-8">
        {isNew ? (
          <GettingStarted
            hasKey={activeKeys.length > 0}
            keyPrefix={activeKeys[0]?.prefix}
            connected={data.keys.some((k) => k.lastUsedAt)}
          />
        ) : (
          <>
            {showOnboarding && (
              <div className="mb-6">
                <OnboardingPanel />
              </div>
            )}
            <OverviewPanel data={data} days={WINDOW_DAYS} />
          </>
        )}
      </div>
    </div>
  );
}
