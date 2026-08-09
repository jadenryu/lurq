import { auth } from "@clerk/nextjs/server";
import { EmptyState, InlineError, eyebrow } from "@/components/dashboard/panel";
import { PageHeader } from "@/components/dashboard/page-header";
import { ReposPanel } from "@/components/dashboard/repos-panel";
import { DriftMeter } from "@/components/dashboard/drift-meter";
import { StatTile } from "@/components/dashboard/stat-tile";
import { Button } from "@/components/ui/button";
import { loadImpact, loadRepos } from "@/lib/dashboard-data";
import { installUrl } from "@/lib/github-connect";

const IMPACT_DAYS = 30;

/** Redirect statuses set by /api/github/callback. */
const CONNECT_MESSAGES: Record<string, string> = {
  ok: "Repositories connected. The first scan is running now — drift appears as it finishes.",
  empty: "The app installed, but no repositories were shared with it.",
  invalid: "That connection link was not valid. Start the install from this page.",
  failed: "GitHub connected, but lurq could not read the installation. Try again.",
};

export default async function ReposPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { userId } = await auth();
  const [{ data, demo, failed }, { data: impact }] = await Promise.all([
    loadRepos(),
    loadImpact(IMPACT_DAYS),
  ]);
  const connect = (await searchParams).connect;
  const message = typeof connect === "string" ? CONNECT_MESSAGES[connect] : undefined;

  const url = userId ? installUrl(userId) : null;

  // Totals across every connected repo. These are the numbers that answer "what
  // is lurq doing for me", so they lead the page rather than sitting under the table.
  const totals = data.repos.reduce(
    (acc, repo) => {
      const drift = repo.drift;
      if (!drift) return acc;
      return {
        deps: acc.deps + drift.depsTracked,
        major: acc.major + drift.majorDrift,
        advisories: acc.advisories + drift.advisories,
        deprecated: acc.deprecated + drift.deprecated,
      };
    },
    { deps: 0, major: 0, advisories: 0, deprecated: 0 },
  );

  return (
    <div>
      <PageHeader
        title="repositories"
        subtitle="How far behind each project is, and what upgrading will break."
        demo={demo}
        action={
          url && data.repos.length > 0 ? (
            <a href={url}>
              <Button variant="outline">Add repositories</Button>
            </a>
          ) : undefined
        }
      />

      <div className="mt-8 space-y-6">
        {message && <InlineError>{message}</InlineError>}

        {!data.configured ? (
          <EmptyState title="GitHub integration isn&rsquo;t set up on this deployment">
            The lurq GitHub app has not been configured for this environment yet, so there is
            nothing to connect to. Set <code className="font-mono text-xs">LURQ_GITHUB_APP_ID</code>
            , <code className="font-mono text-xs">LURQ_GITHUB_APP_PRIVATE_KEY</code>, and{" "}
            <code className="font-mono text-xs">LURQ_GITHUB_APP_SLUG</code> on the API service.
          </EmptyState>
        ) : failed ? (
          <InlineError>
            Could not reach the repository service. Your connected repositories are safe — this is
            a read failure, not a disconnection.
          </InlineError>
        ) : (
          <>
            {impact.analysed > 0 && (
              <div>
                <p className={eyebrow}>last {IMPACT_DAYS} days</p>
                <div className="mt-3 grid grid-cols-2 gap-3 md:grid-cols-4">
                  <StatTile
                    label="breakages caught"
                    value={impact.blocking}
                    hint={`${impact.callSites} call sites that would have failed`}
                  />
                  <StatTile
                    label="upgrades analysed"
                    value={impact.analysed}
                    hint={
                      impact.unverified > 0
                        ? `${impact.unverified} could not be verified`
                        : "all conclusively checked"
                    }
                  />
                  <StatTile label="pull requests" value={impact.prsOpened} />
                  <StatTile
                    label="merged"
                    value={impact.merged}
                    hint={
                      impact.prsOpened > 0
                        ? `${Math.round((impact.merged / impact.prsOpened) * 100)}% of PRs opened`
                        : undefined
                    }
                  />
                </div>
              </div>
            )}

            {data.repos.length > 0 && (
              <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                <StatTile label="repositories" value={data.repos.length} />
                <StatTile
                  label="dependencies tracked"
                  value={totals.deps}
                  hint="across all manifests"
                />
                <StatTile
                  label="majors behind"
                  value={totals.major}
                  hint="the upgrade backlog"
                />
                <DriftMeter
                  behind={totals.major}
                  tracked={totals.deps}
                  deprecated={totals.deprecated}
                />
              </div>
            )}
            <ReposPanel repos={data.repos} demo={demo} installUrl={url} />
          </>
        )}
      </div>
    </div>
  );
}
