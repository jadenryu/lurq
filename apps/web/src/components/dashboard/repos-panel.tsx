"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Chip, EmptyState, InlineError, Panel, PanelHeader } from "@/components/dashboard/panel";
import { TableToolbar } from "@/components/dashboard/table-toolbar";
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
 * "drift", the reader should not have to learn a vocabulary to know whether the
 * number is bad.
 */
function DriftCell({ repo }: { repo: DashboardRepo }) {
  const drift = repo.drift;
  if (!drift) {
    return <span className="font-mono text-xs text-ink-2/60">not scanned</span>;
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

/**
 * Direct and transitive advisories are shown as separate chips, never summed.
 * You fix them differently: one by bumping your own manifest, the other by
 * upgrading whatever pulls it in, so a combined number is unactionable.
 */
function RiskCell({ repo }: { repo: DashboardRepo }) {
  const drift = repo.drift;
  if (!drift) return <span className="text-ink-2/50">-</span>;
  const transitive = drift.transitive?.advisoryPackages ?? 0;
  if (drift.advisories === 0 && drift.deprecated === 0 && transitive === 0) {
    // "not read" is not "none": say so when the tree was never visible.
    return (
      <span className="text-ink-2/50">
        {drift.transitive ? "none" : "direct only"}
      </span>
    );
  }
  return (
    <span className="flex flex-wrap items-center gap-1.5">
      {drift.advisories > 0 && <Chip tone="bad">{drift.advisories} advisory</Chip>}
      {transitive > 0 && <Chip tone="warn">{transitive} transitive</Chip>}
      {drift.deprecated > 0 && <Chip tone="warn">{drift.deprecated} deprecated</Chip>}
    </span>
  );
}

/**
 * Coverage is shown as `tracked / declared`, never as a single percentage of
 * "healthy" deps. A dependency lurq has not indexed is not a dependency it has
 * cleared, and collapsing the two would let the dashboard imply an all-clear it
 * did not earn: the same rule `unverified` follows in the upgrade checker.
 */
function CoverageCell({ repo }: { repo: DashboardRepo }) {
  const drift = repo.drift;
  if (!drift) return <span className="text-ink-2/50">-</span>;
  const uncovered = drift.depsDeclared - drift.depsTracked;
  return (
    <span className="font-mono text-xs tabular-nums">
      {drift.depsTracked}
      <span className="text-ink-2/50">/{drift.depsDeclared}</span>
      {uncovered > 0 && (
        <span className="ml-1.5 text-ink-2/50">({uncovered} unknown)</span>
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
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("all");

  /**
   * Filter by the two questions someone opening this page is actually asking:
   * which of these is behind, and which of these is armed to do something about
   * it. Not a chip per field: a chip nobody clicks costs the same room as one
   * everybody does.
   */
  const shown = repos.filter((repo) => {
    if (query && !repo.fullName.toLowerCase().includes(query.toLowerCase())) return false;
    if (filter === "behind") return (repo.drift?.majorDrift ?? 0) > 0;
    if (filter === "armed") return repo.policy.enabled;
    return true;
  });

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
        dependencies are, and which of those upgrades will break code you actually reference.
        Only manifests are read; your source stays in your repo.
      </EmptyState>
    );
  }

  return (
    <div className="space-y-4">
      <TableToolbar
        query={query}
        onQueryChange={setQuery}
        placeholder="Search repositories…"
        filters={[
          { id: "all", label: "All" },
          { id: "behind", label: "Behind" },
          { id: "armed", label: "Armed" },
        ]}
        activeFilter={filter}
        onFilterChange={setFilter}
        count={shown.length}
        noun="repository"
      />
      <Panel padding="none" className="overflow-hidden">
        <PanelHeader
          title="connected repositories"
          className="px-5 pt-5 md:px-6 md:pt-6"
          trailing={
            <span className="font-mono text-xs text-ink-2">
              {armed} of {repos.length} armed
            </span>
          }
        />
        <div className="mt-4">
          <Table>
            <TableHeader>
              <TableRow className="border-edge">
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
              {shown.map((repo) => (
                <TableRow key={repo.id} className="border-edge">
                  <TableCell className="pl-5 md:pl-6">
                    <Link
                      href={`/dashboard/repos/${repo.id}`}
                      className="font-mono text-sm hover:text-signal"
                    >
                      {repo.fullName}
                    </Link>
                    {repo.isPrivate && (
                      <span className="ml-2 font-mono text-[0.65rem] text-ink-2/50">
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
                    {/* A chip that states a setting reads as a control, so it
                        has to behave like one. The setting itself lives on the
                        repo page (RepoPolicyPanel) because choosing a scope
                        needs the explanation next to it, which does not fit a
                        table cell, so this goes there rather than pretending
                        to toggle in place. */}
                    <Link
                      href={`/dashboard/repos/${repo.id}#autopilot`}
                      className="rounded-[var(--radius-chip)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-mark"
                      title={
                        repo.policy.enabled
                          ? `Autopilot is on for ${repo.policy.scope} upgrades, change it`
                          : "Autopilot is off, turn it on"
                      }
                    >
                      <Chip
                        tone={repo.policy.enabled ? "accent" : "neutral"}
                        className="cursor-pointer transition-colors hover:border-edge-lit hover:text-ink"
                      >
                        {repo.policy.enabled ? repo.policy.scope : "off"}
                      </Chip>
                    </Link>
                  </TableCell>
                  <TableCell>
                    <span
                      className={cn(
                        "font-mono text-xs",
                        repo.lastScanError ? "text-bad" : "text-ink-2",
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
          access was removed: open a repository below for the exact error.
        </InlineError>
      )}
    </div>
  );
}
