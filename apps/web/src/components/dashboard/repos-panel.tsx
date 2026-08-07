"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Chip, EmptyState, InlineError, Panel, PanelHeader } from "@/components/dashboard/panel";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { relativeTime } from "@/lib/format";
import type { DashboardRepo } from "@/lib/lurq-issuer";
import { cn } from "@/lib/utils";

/**
 * The drift column is the product's one-line pitch, so it is rendered as a
 * sentence ("9 majors behind") rather than a bare integer in a column called
 * "drift" — the reader should not have to learn a vocabulary to know whether the
 * number is bad.
 */
function DriftCell({ repo }: { repo: DashboardRepo }) {
  const drift = repo.drift;
  if (!drift) {
    return <span className="font-mono text-xs text-muted-foreground/60">not scanned</span>;
  }
  if (drift.majorDrift === 0 && drift.anyDrift === 0) {
    return <Chip tone="good">current</Chip>;
  }
  return (
    <span className="flex flex-wrap items-center gap-1.5">
      {drift.majorDrift > 0 && (
        <Chip tone="bad">
          {drift.majorDrift} major{drift.majorDrift === 1 ? "" : "s"} behind
        </Chip>
      )}
      {drift.anyDrift > drift.majorDrift && (
        <Chip tone="warn">{drift.anyDrift - drift.majorDrift} minor</Chip>
      )}
    </span>
  );
}

function RiskCell({ repo }: { repo: DashboardRepo }) {
  const drift = repo.drift;
  if (!drift) return <span className="text-muted-foreground/50">—</span>;
  if (drift.advisories === 0 && drift.deprecated === 0) {
    return <span className="text-muted-foreground/50">none</span>;
  }
  return (
    <span className="flex flex-wrap items-center gap-1.5">
      {drift.advisories > 0 && <Chip tone="bad">{drift.advisories} advisory</Chip>}
      {drift.deprecated > 0 && <Chip tone="warn">{drift.deprecated} deprecated</Chip>}
    </span>
  );
}

/**
 * Coverage is shown as `tracked / declared`, never as a single percentage of
 * "healthy" deps. A dependency lurq has not indexed is not a dependency it has
 * cleared, and collapsing the two would let the dashboard imply an all-clear it
 * did not earn — the same rule `unverified` follows in the upgrade checker.
 */
function CoverageCell({ repo }: { repo: DashboardRepo }) {
  const drift = repo.drift;
  if (!drift) return <span className="text-muted-foreground/50">—</span>;
  const uncovered = drift.depsDeclared - drift.depsTracked;
  return (
    <span className="font-mono text-xs tabular-nums">
      {drift.depsTracked}
      <span className="text-muted-foreground/50">/{drift.depsDeclared}</span>
      {uncovered > 0 && (
        <span className="ml-1.5 text-muted-foreground/50">({uncovered} unknown)</span>
      )}
    </span>
  );
}

function RepoRowActions({ repo, demo }: { repo: DashboardRepo; demo: boolean }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  async function rescan() {
    setError(null);
    const res = await fetch(`/api/repos/${repo.id}/scan`, { method: "POST" });
    if (!res.ok) {
      const body = (await res.json().catch(() => null)) as { error?: string } | null;
      setError(body?.error ?? "Scan failed.");
      return;
    }
    startTransition(() => router.refresh());
  }

  return (
    <span className="flex items-center justify-end gap-2">
      {error && <span className="font-mono text-[0.65rem] text-bad">{error}</span>}
      <Button
        variant="ghost"
        size="sm"
        disabled={demo || pending}
        onClick={() => void rescan()}
        title={demo ? "Not available on demo data" : "Re-read manifests from GitHub"}
      >
        {pending ? "scanning…" : "rescan"}
      </Button>
    </span>
  );
}

export function ReposPanel({
  repos,
  demo,
  installUrl,
}: {
  repos: DashboardRepo[];
  demo: boolean;
  installUrl: string | null;
}) {
  const armed = repos.filter((r) => r.policy.enabled).length;

  if (repos.length === 0) {
    return (
      <EmptyState
        title="No repositories connected"
        action={
          installUrl ? (
            <a href={installUrl} className="inline-block">
              <Button>Connect GitHub</Button>
            </a>
          ) : undefined
        }
      >
        Connect the lurq GitHub app and it reads each repository&rsquo;s{" "}
        <code className="font-mono text-xs">package.json</code> to show how far behind its
        dependencies are — and which of those upgrades will break code you actually reference.
        Only manifests are read; your source stays in your repo.
      </EmptyState>
    );
  }

  return (
    <div className="space-y-4">
      <Panel padding="none" className="overflow-hidden">
        <PanelHeader
          title="connected repositories"
          className="px-5 pt-5 md:px-6 md:pt-6"
          trailing={
            <span className="font-mono text-xs text-muted-foreground">
              {armed} of {repos.length} armed
            </span>
          }
        />
        <div className="mt-4">
          <Table>
            <TableHeader>
              <TableRow className="border-border">
                <TableHead className="pl-5 md:pl-6">repository</TableHead>
                <TableHead>drift</TableHead>
                <TableHead>risk</TableHead>
                <TableHead>coverage</TableHead>
                <TableHead>autopilot</TableHead>
                <TableHead>last scan</TableHead>
                <TableHead className="pr-5 text-right md:pr-6">&nbsp;</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {repos.map((repo) => (
                <TableRow key={repo.id} className="border-border">
                  <TableCell className="pl-5 md:pl-6">
                    <Link
                      href={`/dashboard/repos/${repo.id}`}
                      className="font-mono text-sm hover:text-signal"
                    >
                      {repo.fullName}
                    </Link>
                    {repo.isPrivate && (
                      <span className="ml-2 font-mono text-[0.65rem] text-muted-foreground/50">
                        private
                      </span>
                    )}
                  </TableCell>
                  <TableCell>
                    <DriftCell repo={repo} />
                  </TableCell>
                  <TableCell>
                    <RiskCell repo={repo} />
                  </TableCell>
                  <TableCell>
                    <CoverageCell repo={repo} />
                  </TableCell>
                  <TableCell>
                    <Chip tone={repo.policy.enabled ? "accent" : "neutral"}>
                      {repo.policy.enabled ? repo.policy.scope : "off"}
                    </Chip>
                  </TableCell>
                  <TableCell>
                    <span
                      className={cn(
                        "font-mono text-xs",
                        repo.lastScanError ? "text-bad" : "text-muted-foreground",
                      )}
                    >
                      {repo.lastScanError
                        ? "failed"
                        : repo.lastScanAt
                          ? relativeTime(repo.lastScanAt)
                          : "never"}
                    </span>
                  </TableCell>
                  <TableCell className="pr-5 text-right md:pr-6">
                    <RepoRowActions repo={repo} demo={demo} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </Panel>

      {repos.some((r) => r.lastScanError) && (
        <InlineError>
          Some repositories could not be read. The most likely cause is that the lurq app&rsquo;s
          access was removed — open a repository below for the exact error.
        </InlineError>
      )}
    </div>
  );
}
