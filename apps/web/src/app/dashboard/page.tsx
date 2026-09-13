import Link from "next/link";
import { currentOwner } from "@/lib/owner";
import { buttonVariants } from "@/components/ui/button";
import { GettingStarted } from "@/components/dashboard/getting-started";
import { OnboardingPanel } from "@/components/dashboard/onboarding-panel";
import { OverviewPanel } from "@/components/dashboard/overview-panel";
import { PageBody, PageHeader } from "@/components/dashboard/page-header";
import { parseDays } from "@/components/dashboard/range-tabs";
import { loadOverview, loadRepos } from "@/lib/dashboard-data";
import { installUrl } from "@/lib/github-connect";

/**
 * Twice the window is read, and only the recent half is charted. The window
 * itself is `?days=`, picked from the control in the requests chart header.
 *
 * Every headline number on this page carries a change figure, and a change
 * figure needs a baseline. Splitting the reported window in half would be the
 * cheap version of this and it lies: "last 15 days vs the 15 before" is not the
 * 30-day trend anybody thinks they are reading. One request for 60 days, sliced
 * in the panel, makes the comparison the one it claims to be.
 */
export default async function DashboardOverviewPage(props: PageProps<"/dashboard">) {
  const days = parseDays((await props.searchParams).days);
  // Repos are read for the setup checklist's fourth step. In parallel, and it
  // already degrades to an empty list on failure, so a repo-service outage
  // costs this page a row rather than the whole render.
  const [{ data, demo, failed }, owner, repos] = await Promise.all([
    loadOverview(days * 2),
    currentOwner(),
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

      <PageBody>
        {isNew ? (
          <GettingStarted
            hasKey={activeKeys.length > 0}
            keyPrefix={activeKeys[0]?.prefix}
            connected={data.keys.some((k) => k.lastUsedAt)}
            installUrl={repos.data.configured && owner ? installUrl(owner.ownerId) : null}
            repoCount={repos.data.repos.length}
          />
        ) : (
          <>
            {showOnboarding && (
              <div className="mb-6">
                <OnboardingPanel />
              </div>
            )}
            <OverviewPanel data={data} days={days} />
          </>
        )}
      </PageBody>
    </div>
  );
}
