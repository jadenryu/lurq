"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Chip, EmptyState, InlineError, Panel, PanelHeader } from "@/components/dashboard/panel";
import { ScanProgress } from "@/components/dashboard/scan-progress";
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
import { isScanPending } from "@/lib/repo-scan";
import { repoMode, type DashboardRepo, type RepoPolicy } from "@/lib/lurq-issuer";
import { RepoPolicyPanel } from "@/components/dashboard/repo-policy";
import { cn } from "@/lib/utils";

/**
 * What a selection starts from when the first selected repo has no policy.
 * Mirrors DEFAULT_REPO_POLICY on the backend; the web keeps its own RepoPolicy
 * type by design, so this is the same deliberate duplication.
 */
const DEFAULT_POLICY: RepoPolicy = {
  enabled: false,
  scope: "blocking",
  autoMerge: false,
  checks: { env: true },
};

/**
 * The drift column is the product's one-line pitch, so it is rendered as a
 * sentence ("9 majors behind") rather than a bare integer in a column called
 * "drift", the reader should not have to learn a vocabulary to know whether the
 * number is bad.
 */
function DriftCell({ repo }: { repo: DashboardRepo }) {
  const drift = repo.drift;
  if (!drift) {
    // "not scanned" and "being scanned right now" are different facts, and the
    // first one reads as a dead end. A repo connected 20 seconds ago is in the
    // second state for as long as the first scan takes.
    return (
      <span className="font-mono text-xs text-ink-3">
        {isScanPending(repo) ? "scanning…" : "not scanned"}
      </span>
    );
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
 *
 * "pending" rather than "unknown": a scan now queues every dependency it could
 * not find for background ingestion (src/github/drift.ts), so the gap closes on
 * its own by the next scan. The exception is a package that is not on the public
 * registry at all — a private `@scope/*` — which stays uncovered, so the word
 * still has to be one that does not promise.
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
        <span className="ml-1.5 text-ink-2/50">({uncovered} pending)</span>
      )}
    </span>
  );
}

function RepoRowActions({ repo, demo }: { repo: DashboardRepo; demo: boolean }) {
  const router = useRouter();
  const [refreshing, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  /**
   * The fetch is the slow part — POST /scan awaits the whole scan server-side,
   * which is seconds of GitHub calls. `useTransition`'s flag only covers the
   * refresh *after* that resolves, so the button used to sit there saying
   * "rescan", enabled, for the entire scan: no feedback, and a second click
   * would fire a second scan. This covers the fetch; `refreshing` covers the
   * re-render after it.
   */
  const [scanning, setScanning] = useState(false);
  const busy = scanning || refreshing;

  async function rescan() {
    setError(null);
    setScanning(true);
    try {
      const res = await fetch(`/api/repos/${repo.id}/scan`, { method: "POST" });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        setError(body?.error ?? "Scan failed.");
        return;
      }
      startTransition(() => router.refresh());
    } catch {
      setError("Scan failed.");
    } finally {
      setScanning(false);
    }
  }

  return (
    <span className="flex items-center justify-end gap-2">
      {error && <span className="font-mono text-[0.65rem] text-bad">{error}</span>}
      <Button
        variant="ghost"
        size="sm"
        disabled={demo || busy}
        onClick={() => void rescan()}
        title={demo ? "Not available on demo data" : "Re-read manifests from GitHub"}
      >
        {busy ? (
          <span className="flex items-center gap-1.5">
            <span
              aria-hidden
              className="inline-block size-1.5 animate-pulse rounded-full bg-signal motion-reduce:animate-none"
            />
            scanning…
          </span>
        ) : (
          "rescan"
        )}
      </Button>
    </span>
  );
}

/**
 * Armed, still behind, and never reported a run.
 *
 * All three conditions are required. Armed with no runs is not a problem by
 * itself — a repo with nothing to upgrade reports nothing, so silence is
 * ambiguous with "nothing to do". It is the combination of permitted to act,
 * work outstanding, and never heard from that means the workflow was probably
 * never committed.
 */
function isStalled(repo: DashboardRepo): boolean {
  return repo.policy.enabled && (repo.drift?.majorDrift ?? 0) > 0 && repo.upkeep === null;
}

/**
 * Armed, reporting runs, and every one of them only analysed.
 *
 * A different failure from `isStalled`: the workflow is committed and running,
 * it just never gets past a comment. This reads the count the API returns
 * rather than inferring from `delivered === 0`, because a healthy repo with
 * nothing worth a pull request also delivers nothing — `checked` is defined as
 * "analysed only (comment mode, or the agent step was not armed)", so an
 * all-`checked` history is evidence and `delivered === 0` is a guess.
 *
 * Kept apart from `isStalled` because the remedy differs: that one needs the
 * workflow committed, this one needs either a secret added or the file replaced
 * — see `analysingCause`.
 *
 * A policy that genuinely says `comment` is NOT flagged. Analysing is what that
 * repo asked for, and calling it a fault would have the column cry wolf at
 * every user who deliberately chose to look before touching anything.
 */
function isAnalysingOnly(repo: DashboardRepo): boolean {
  const upkeep = repo.upkeep;
  if (!upkeep || repoMode(repo.policy) === "comment") return false;
  return upkeep.runs > 0 && upkeep.analysedOnly === upkeep.runs;
}

/**
 * WHY an armed repo only ever analysed — the part the old copy guessed at.
 *
 * Both causes leave an identical run history, so the policy's own mode is what
 * separates them:
 *
 *   `fix` needs no Anthropic credential at all, so a repo set to `fix` that
 *   opened nothing can only be running a workflow file that predates the
 *   runtime mode lookup, or one that pins its own mode. The file is the fault.
 *
 *   `pr` needs a credential, and the credential gate runs AFTER the step that
 *   reports the run — so a missing or expired secret posts `checked` rows and
 *   then fails the job, which from here looks exactly like a stale file. The
 *   secret is both likelier and recurring: a `claude setup-token` token lasts
 *   one year and lapses with no warning, on a schedule nobody is watching.
 */
function analysingCause(repo: DashboardRepo): "credential" | "file" | null {
  if (!isAnalysingOnly(repo)) return null;
  return repoMode(repo.policy) === "pr" ? "credential" : "file";
}

/** The hover text for the last-run cell, which has four distinct cases. */
function lastRunTitle(repo: DashboardRepo): string {
  const upkeep = repo.upkeep;
  if (!upkeep) {
    return isStalled(repo)
      ? "Armed and still behind, but the workflow has never reported a run — it may not be committed"
      : "No runs reported yet";
  }
  const counts = `${upkeep.runs} run(s), ${upkeep.delivered} reached a pull request${upkeep.failed ? `, ${upkeep.failed} failed` : ""}`;
  const cause = analysingCause(repo);
  if (!cause) return counts;
  return cause === "credential"
    ? `${counts}, and nothing opened. This repo is set to pr mode, which needs ANTHROPIC_API_KEY or CLAUDE_CODE_OAUTH_TOKEN in its repository secrets — and an OAuth token expires a year after it was created. Check the secret before the workflow file.`
    : `${counts}, and nothing opened. Set to fix mode, which needs no API key, so the workflow file is the problem: it predates lurq reading this setting at run time, or pins its own mode. Re-copy it from the repository page.`;
}

/**
 * The policy editor for a selection, on the same controls as one repo.
 *
 * Seeded from the first selected repo rather than from a blank policy: the
 * common case is "make these look like that one", and starting from the shipped
 * default would quietly disarm a selection of armed repos if the user saved
 * without reading every control.
 *
 * Saving REPLACES the policy on every selected repo — stated in the intro,
 * because the panel is otherwise identical to the one that edits a single
 * repository and nothing else on screen says the blast radius changed.
 */
function BulkPolicy({
  ids,
  names,
  seed,
  demo,
  onClear,
}: {
  ids: number[];
  /** Selected repos that have never reported a run: the ones arming leaves unfinished. */
  names: string[];
  seed: RepoPolicy | undefined;
  demo: boolean;
  onClear: () => void;
}) {
  const noun = ids.length === 1 ? "repository" : "repositories";
  return (
    <RepoPolicyPanel
      endpoint="/api/repos/bulk"
      title={`${ids.length} selected`}
      intro={`Saving replaces the autopilot policy on ${ids.length} selected ${noun}. Settings they have now are overwritten.`}
      policy={seed ?? DEFAULT_POLICY}
      demo={demo}
      body={{ ids }}
      saveLabel={`apply to ${ids.length} ${noun}`}
      // Applying an unedited policy to a selection is still a change to every
      // repo in it that did not already have that policy.
      alwaysSavable
      // Arming keeps the selection so the setup step below the switch stays on
      // screen; clearing it would hide the one step that makes the save matter.
      onSaved={(saved) => {
        if (repoMode(saved) === "comment") onClear();
      }}
      setupRepos={names}
      extra={
        <Button variant="ghost" size="sm" onClick={onClear}>
          clear selection
        </Button>
      }
    />
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
  const stalled = repos.filter(isStalled).length;
  const analysing = repos.filter(isAnalysingOnly).length;
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("all");
  /**
   * Selection is by id and survives a filter change on purpose.
   *
   * Filtering to "behind", selecting six, then filtering to "armed" must not
   * silently drop five of them — the bar keeps stating the true count, and
   * "clear" is the only thing that empties it. The alternative loses a
   * selection the user built across two filters with no message saying so.
   */
  const [selected, setSelected] = useState<ReadonlySet<number>>(() => new Set());

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
    // One chip for both: the question being asked is "which armed repo is not
    // actually landing anything", and a chip nobody clicks costs the same room
    // as one everybody does. The row badges still say which of the two it is.
    if (filter === "stalled") return isStalled(repo) || isAnalysingOnly(repo);
    return true;
  });

  const shownIds = shown.map((r) => r.id);
  const allShownSelected = shownIds.length > 0 && shownIds.every((id) => selected.has(id));
  const toggle = (id: number) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (!next.delete(id)) next.add(id);
      return next;
    });
  const toggleAllShown = () =>
    setSelected((prev) => {
      const next = new Set(prev);
      // Acts on what is on screen, never on the whole account: a header
      // checkbox that silently reached filtered-out rows would arm repos the
      // user cannot see from here.
      for (const id of shownIds) {
        if (allShownSelected) next.delete(id);
        else next.add(id);
      }
      return next;
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
      {/* Demo fixtures are already scanned and never change, so polling them
          would refresh the route forever for nothing. */}
      {!demo && (
        <ScanProgress pending={repos.filter(isScanPending).length} total={repos.length} />
      )}

      <TableToolbar
        query={query}
        onQueryChange={setQuery}
        placeholder="Search repositories…"
        filters={[
          { id: "all", label: "All" },
          { id: "behind", label: "Behind" },
          { id: "armed", label: "Armed" },
          { id: "stalled", label: "Stalled" },
        ]}
        activeFilter={filter}
        onFilterChange={setFilter}
        count={shown.length}
        noun="repository"
      />
      {selected.size > 0 && (
        <BulkPolicy
          ids={[...selected]}
          names={repos.filter((r) => selected.has(r.id) && !r.upkeep).map((r) => r.fullName)}
          seed={repos.find((r) => selected.has(r.id))?.policy}
          demo={demo}
          onClear={() => setSelected(new Set())}
        />
      )}

      <Panel padding="none" className="overflow-hidden">
        <PanelHeader
          title="connected repositories"
          className="px-5 pt-5 md:px-6 md:pt-6"
          trailing={
            <span className="font-mono text-xs text-ink-2">
              {armed} of {repos.length} armed
              {stalled > 0 && <span className="text-bad"> · {stalled} never ran</span>}
              {/* Never summed with `stalled`: you fix them differently, the
                  same rule the risk column follows. */}
              {analysing > 0 && (
                <span className="text-warn"> · {analysing} analysing only</span>
              )}
            </span>
          }
        />
        <div className="mt-4">
          <Table>
            <TableHeader>
              <TableRow className="border-edge">
                <TableHead className="w-10 pl-5 md:pl-6">
                  <input
                    type="checkbox"
                    checked={allShownSelected}
                    onChange={toggleAllShown}
                    disabled={demo || shownIds.length === 0}
                    aria-label={`Select all ${shownIds.length} shown repositories`}
                    className="size-4 accent-[var(--signal)]"
                  />
                </TableHead>
                <TableHead>repository</TableHead>
                <TableHead>drift</TableHead>
                <TableHead>risk</TableHead>
                <TableHead>coverage</TableHead>
                <TableHead>autopilot</TableHead>
                <TableHead>last scan</TableHead>
                <TableHead>last run</TableHead>
                <TableHead className="pr-5 text-right md:pr-6">&nbsp;</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {shown.map((repo) => (
                <TableRow key={repo.id} className="border-edge">
                  <TableCell className="pl-5 md:pl-6">
                    <input
                      type="checkbox"
                      checked={selected.has(repo.id)}
                      onChange={() => toggle(repo.id)}
                      disabled={demo}
                      aria-label={`Select ${repo.fullName}`}
                      className="size-4 accent-[var(--signal)]"
                    />
                  </TableCell>
                  <TableCell>
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
                          : "scanning…"}
                    </span>
                  </TableCell>
                  <TableCell>
                    {/* A different fact from "last scan": that is lurq reading
                        the manifests from our side, this is their workflow
                        running on theirs. A repo can be armed with the workflow
                        never committed, and only this column shows it. */}
                    <span
                      className={cn(
                        "font-mono text-xs",
                        isStalled(repo)
                          ? "text-bad"
                          : isAnalysingOnly(repo)
                            ? "text-warn"
                            : "text-ink-2",
                      )}
                      title={lastRunTitle(repo)}
                    >
                      {repo.upkeep ? relativeTime(repo.upkeep.lastRunAt) : "never"}
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
