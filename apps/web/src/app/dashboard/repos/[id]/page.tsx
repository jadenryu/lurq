import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/dashboard/page-header";
import { InlineError } from "@/components/dashboard/panel";
import { RepoDeps } from "@/components/dashboard/repo-deps";
import { RepoPolicyPanel } from "@/components/dashboard/repo-policy";
import { StatTile } from "@/components/dashboard/stat-tile";
import { buttonVariants } from "@/components/ui/button";
import { loadRepo } from "@/lib/dashboard-data";
import { relativeTime } from "@/lib/format";

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

  return (
    <div>
      <PageHeader
        title={repo.fullName}
        subtitle={
          repo.lastScanAt
            ? `Manifests read ${relativeTime(repo.lastScanAt)} from ${repo.defaultBranch ?? "the default branch"}.`
            : "Not scanned yet."
        }
        demo={demo}
        action={
          <Link href="/dashboard/repos" className={buttonVariants({ variant: "outline" })}>
            All repositories
          </Link>
        }
      />

      <div className="mt-8 space-y-6">
        {repo.lastScanError && <InlineError>{repo.lastScanError}</InlineError>}

        {drift && (
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <StatTile
              label="tracked"
              value={drift.depsTracked}
              hint={uncovered > 0 ? `${uncovered} not in the index` : "full coverage"}
            />
            <StatTile
              label="behind"
              value={drift.anyDrift}
              hint={`${drift.majorDrift} across a major`}
            />
            <StatTile label="advisories" value={drift.advisories} />
            <StatTile label="deprecated" value={drift.deprecated} />
          </div>
        )}

        <RepoPolicyPanel repoId={repo.id} policy={repo.policy} demo={demo} />

        <RepoDeps deps={repo.deps} />
      </div>
    </div>
  );
}
