import { Suspense } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { MigrationBrief } from "@/components/dashboard/migration-brief";
import { PageBody, PageHeader } from "@/components/dashboard/page-header";
import { InlineError, Panel, PanelHeader } from "@/components/dashboard/panel";
import { RepoDeps } from "@/components/dashboard/repo-deps";
import { RepoPolicyPanel } from "@/components/dashboard/repo-policy";
import { RepoSetup } from "@/components/dashboard/repo-setup";
import { ScanProgress } from "@/components/dashboard/scan-progress";
import { StackConflictsPanel } from "@/components/dashboard/stack-conflicts";
import { TransitiveRiskPanel } from "@/components/dashboard/transitive-risk";
import { UpgradeRuns } from "@/components/dashboard/upgrade-runs";
import { StatRow, StatTile } from "@/components/dashboard/stat-tile";
import { buttonVariants } from "@/components/ui/button";
import { loadRepo, loadRepoBrief } from "@/lib/dashboard-data";
import { relativeTime } from "@/lib/format";
import { isScanPending } from "@/lib/repo-scan";

async function Brief({ id }: { id: number }) {
  const { data, failed } = await loadRepoBrief(id);
  return <MigrationBrief brief={data} failed={failed} />;
}

function BriefSkeleton() {
  return (
    <div className="space-y-4">
      <PanelHeader title="migration brief" />
      <div className="space-y-3">
        {[0, 1, 2].map((i) => (
          <Panel key={i} padding="tight">
            <div className="h-5 w-2/5 animate-pulse rounded bg-muted" />
          </Panel>
        ))}
      </div>
    </div>
  );
}

export default async function RepoDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const id = Number((await params).id);
  if (!Number.isInteger(id)) notFound();

  const { data: repo, demo } = await loadRepo(id);
  if (!repo) notFound();

  const drift = repo.drift;
  const uncovered = drift ? drift.depsDeclared - drift.depsTracked : 0;
  const scanning = !demo && isScanPending(repo);

  return (
    <div>
      <PageHeader
        title={repo.fullName}
        subtitle={
          repo.lastScanAt
            ? `Manifests read ${relativeTime(repo.lastScanAt)} from ${repo.defaultBranch ?? "the default branch"}.`
            : scanning
              ? `Reading manifests from ${repo.defaultBranch ?? "the default branch"} now.`
              : "Not scanned yet."
        }
        demo={demo}
        action={
          <Link href="/dashboard/repos" className={buttonVariants({ variant: "outline" })}>
            All repositories
          </Link>
        }
      />

      <PageBody>
        {/* Polls this route until the first scan lands, so the page fills itself
            in instead of waiting for someone to guess that rescan is the only
            thing that ever re-reads the data. */}
        <ScanProgress pending={scanning ? 1 : 0} />

        {repo.lastScanError && <InlineError>{repo.lastScanError}</InlineError>}

        {drift && (
          <StatRow>
            <StatTile
              label="tracked"
              value={drift.depsTracked}
              hint={
                uncovered > 0 ? `${uncovered} queued for indexing` : "full coverage"
              }
            />
            {/* Each tile links to the rows it counts. A number you cannot open
                is a claim you have to take on faith, which is the opposite of
                what this product sells. `href` only where a filter actually
                exists — a tile that navigates to an unfiltered table is worse
                than one that stays put. */}
            <StatTile
              label="behind"
              value={drift.anyDrift}
              hint={`${drift.majorDrift} across a major`}
              href={drift.anyDrift > 0 ? "?show=drifted#deps" : undefined}
            />
            {/* Scoped, not bare. "0" against hundreds of dependencies reads as
                an all-clear; it is only ever a statement about the packages
                lurq has indexed, and advisories are recorded against the
                package rather than proven against the installed version. */}
            <StatTile
              label="advisories"
              value={drift.advisories}
              hint={
                uncovered > 0
                  ? `in the ${drift.depsTracked} indexed`
                  : "on indexed packages"
              }
              href={drift.advisories > 0 ? "?show=risk#deps" : undefined}
            />
            <StatTile
              label="deprecated"
              value={drift.deprecated}
              href={drift.deprecated > 0 ? "?show=risk#deps" : undefined}
            />
            {/* "-" rather than 0 when the scan predates the check: an unrun check
                must never occupy the same cell as one that found nothing. */}
            <StatTile
              label="conflicts"
              value={drift.conflicts ?? "-"}
              hint={drift.conflicts === null ? "rescan to check" : "at latest versions"}
            />
          </StatRow>
        )}

        {/* The brief fans out to one surface diff per upgrade, so it streams in
            behind the drift numbers rather than holding the whole page. */}
        <Suspense fallback={<BriefSkeleton />}>
          <Brief id={repo.id} />
        </Suspense>

        <StackConflictsPanel conflicts={repo.conflicts} />

        <TransitiveRiskPanel
          summary={drift?.transitive ?? null}
          risks={repo.transitiveRisks}
        />

        <UpgradeRuns runs={repo.runs} />

        <RepoPolicyPanel repoId={repo.id} policy={repo.policy} demo={demo} />

        <RepoSetup
          workflow={repo.workflow}
          workflowPath={repo.workflowPath}
          setupUrl={repo.setupUrl}
          armed={repo.policy.enabled}
        />

        {/* useSearchParams (RepoDeps reads ?show= and ?q=) client-renders the
            tree up to the nearest Suspense boundary on a prerendered route.
            This route is dynamic today so nothing bails out, but the Next docs
            note that on-demand dev rendering hides exactly this — the boundary
            costs nothing and stops a future static render from taking the whole
            page client-side. */}
        <Suspense fallback={null}>
          <RepoDeps deps={repo.deps} scanning={scanning} />
        </Suspense>
      </PageBody>
    </div>
  );
}
