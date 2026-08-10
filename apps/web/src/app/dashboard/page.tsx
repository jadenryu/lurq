import Link from "next/link";
import { auth } from "@clerk/nextjs/server";
import { buttonVariants } from "@/components/ui/button";
import { GettingStarted } from "@/components/dashboard/getting-started";
import { OnboardingPanel } from "@/components/dashboard/onboarding-panel";
import { OverviewPanel } from "@/components/dashboard/overview-panel";
import { PageHeader } from "@/components/dashboard/page-header";
import { loadOverview, loadRepos } from "@/lib/dashboard-data";
import { installUrl } from "@/lib/github-connect";

const WINDOW_DAYS = 30;

export default async function DashboardOverviewPage() {
  // Repos are read for the setup checklist's fourth step. In parallel, and it
  // already degrades to an empty list on failure, so a repo-service outage
  // costs this page a row rather than the whole render.
  const [{ data, demo, failed }, { userId }, repos] = await Promise.all([
    loadOverview(WINDOW_DAYS),
    auth(),
    loadRepos(),
  ]);

  const activeKeys = data.keys.filter((k) => !k.revokedAt);
  const calls = data.usage.series.reduce((s, p) => s + p.count, 0);

  // Nothing to chart, nothing to list, either a genuinely fresh account, or a
  // read that failed and therefore also has nothing to show. Both get the setup
  // path: an empty chart frame and four tiles reading `0` tell that person less
  // than one page explaining how to produce data does, and a first-time visitor
  // should never be greeted with a connection error. `failed` is logged in
  // dashboard-data so an outage is still traceable.
  const isNew =
    failed || (calls === 0 && data.outcomes.length === 0 && data.contributions.total === 0);

  // Has a key but has never used it: the one case where the nudge is the missing
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
            installUrl={repos.data.configured && userId ? installUrl(userId) : null}
            repoCount={repos.data.repos.length}
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
