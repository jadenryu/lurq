import { AutopilotLog } from "@/components/dashboard/autopilot-log";
import { PageBody, PageHeader } from "@/components/dashboard/page-header";
import { loadRepos, loadRuns } from "@/lib/dashboard-data";
import { repoMode } from "@/lib/lurq-issuer";

/**
 * What the autopilot has actually done, across every repository.
 *
 * The repo page could always answer "what happened to this repo", and nothing
 * anywhere answered "what has lurq been doing at all" — which is the first
 * question after arming it and seeing no pull requests. Without this page the
 * two explanations for silence are indistinguishable: nothing needed doing, or
 * the workflow was never committed and nothing will ever happen.
 *
 * The repo list is read only for the armed count, which is what lets the empty
 * state tell those two apart.
 */
export default async function DashboardRunsPage() {
  const [{ data: runs, demo }, { data: repos }] = await Promise.all([loadRuns(), loadRepos()]);

  // Armed means "would act if a run happened". A repo set to `comment` is not
  // waiting on anything, so counting it would make the empty state claim
  // repositories are stuck when they are doing exactly what was asked.
  const armed = repos.repos.filter((repo) => repoMode(repo.policy) !== "comment").length;

  return (
    <div>
      <PageHeader
        title="autopilot log"
        subtitle="Every upgrade the autopilot has considered, what it concluded, what it did, and why it ran."
        demo={demo}
      />

      <PageBody>
        <AutopilotLog runs={runs} armed={armed} />
      </PageBody>
    </div>
  );
}
