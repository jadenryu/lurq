"use client";

import { useMemo, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Chip, EmptyState, Panel } from "@/components/dashboard/panel";
import { TableToolbar } from "@/components/dashboard/table-toolbar";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { DetailRow, ExpandableRow } from "@/components/dashboard/expandable-row";
import type { DashboardDep } from "@/lib/lurq-issuer";

const FILTERS = [
  { id: "all", label: "all" },
  { id: "drifted", label: "behind" },
  { id: "major", label: "major" },
  { id: "risk", label: "advisory / deprecated" },
];

function matches(dep: DashboardDep, filter: string): boolean {
  switch (filter) {
    case "drifted":
      return dep.resolved !== dep.latest;
    case "major":
      return dep.majorsBehind > 0;
    case "risk":
      return dep.advisories > 0 || dep.deprecated;
    default:
      return true;
  }
}

/**
 * Three versions per row (declared range, what it resolves to, what's current)
 * because the gap between the middle and right column IS the drift, and showing
 * only "latest" next to a caret range makes every repo look out of date.
 */
export function RepoDeps({ deps, scanning = false }: { deps: DashboardDep[]; scanning?: boolean }) {
  const [query, setQuery] = useState("");

  /**
   * The filter lives in the URL, not in local state alone.
   *
   * Three things depend on that and none of them work without it: the stat tiles
   * above link to their own rows (`36 behind` opens the table already filtered to
   * the 36), the browser back button steps out of a filter instead of leaving the
   * page, and a filtered view can be pasted to a colleague. `replace` rather than
   * `push` for typing-adjacent changes would collapse the history; a filter is a
   * deliberate act, so it earns an entry.
   */
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const filter = FILTERS.some((f) => f.id === params.get("show"))
    ? (params.get("show") as string)
    : "all";

  const setFilter = (next: string) => {
    const q = new URLSearchParams(params.toString());
    if (next === "all") q.delete("show");
    else q.set("show", next);
    const qs = q.toString();
    router.replace(qs ? `${pathname}?${qs}#deps` : `${pathname}#deps`, { scroll: false });
  };

  const rows = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return deps.filter(
      (dep) => matches(dep, filter) && (!needle || dep.name.toLowerCase().includes(needle)),
    );
  }, [deps, query, filter]);

  if (deps.length === 0) {
    // Telling someone to go and run a rescan while the first scan is still
    // running is both wrong and the thing that taught people rescan is the only
    // button that does anything.
    return scanning ? (
      <EmptyState title="Reading dependencies">
        The first scan is still running. This list fills in on its own as soon as the manifests
        have been read.
      </EmptyState>
    ) : (
      <EmptyState title="No indexed dependencies yet">
        This repository has not been scanned, or none of its dependencies are in the lurq index
        yet. Run a rescan from the repositories page.
      </EmptyState>
    );
  }

  return (
    // `scroll-mt` so a stat tile linking to #deps lands the heading below the
    // sticky header instead of tucking it underneath.
    <div id="deps" className="scroll-mt-24 space-y-4">
      <TableToolbar
        query={query}
        onQueryChange={setQuery}
        placeholder="Search dependencies…"
        filters={FILTERS}
        activeFilter={filter}
        onFilterChange={setFilter}
        count={rows.length}
        noun="dependency"
      />

      <Panel padding="none" className="overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow className="border-border">
              <TableHead className="w-8 pl-3 pr-0 md:pl-4">
                <span className="sr-only">expand</span>
              </TableHead>
              <TableHead>package</TableHead>
              <TableHead>declared</TableHead>
              <TableHead>resolves to</TableHead>
              <TableHead>latest</TableHead>
              <TableHead className="pr-5 md:pr-6">status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((dep) => (
              <ExpandableRow
                key={dep.name}
                label={dep.name}
                colSpan={6}
                summary={
                  <>
                    <TableCell className="font-mono text-sm">{dep.name}</TableCell>
                    <TableCell className="font-mono text-xs tabular-nums text-muted-foreground">
                      {dep.range}
                    </TableCell>
                    <TableCell className="font-mono text-xs tabular-nums">
                      {dep.resolved ?? "-"}
                    </TableCell>
                    <TableCell className="font-mono text-xs tabular-nums">
                      {dep.latest ?? "-"}
                    </TableCell>
                    <TableCell className="pr-5 md:pr-6">
                      <span className="flex flex-wrap items-center gap-1.5">{statusChips(dep)}</span>
                    </TableCell>
                  </>
                }
                detail={<DepDetail dep={dep} />}
              />
            ))}
          </TableBody>
        </Table>
      </Panel>
    </div>
  );
}

/** The row's status chips, lifted out so the summary cell stays readable. */
function statusChips(dep: DashboardDep) {
  const clean = dep.majorsBehind === 0 && !dep.deprecated && dep.advisories === 0;
  return (
    <>
      {dep.advisories > 0 && (
        <Chip tone="bad">
          {dep.advisories} advisor{dep.advisories === 1 ? "y" : "ies"}
        </Chip>
      )}
      {dep.deprecated && <Chip tone="warn">deprecated</Chip>}
      {dep.majorsBehind > 0 && (
        <Chip tone="bad">
          {dep.majorsBehind} major{dep.majorsBehind === 1 ? "" : "s"}
        </Chip>
      )}
      {clean &&
        (dep.resolved === dep.latest ? (
          <Chip tone="good">current</Chip>
        ) : (
          <Chip tone="neutral">minor behind</Chip>
        ))}
    </>
  );
}

/**
 * What the row opens onto.
 *
 * `declaredIn` is the reason this exists. In a monorepo the summary row's single
 * range is the *lowest* one declared anywhere, which is the right number for
 * "how far behind is this repo" and the wrong one for "what do I edit" — those
 * are different questions and only the first one fits in a cell. Listing every
 * manifest with its own range answers the second without leaving the page.
 *
 * When a package is declared once, the list is one line and says so plainly
 * rather than being hidden: a detail panel that is empty half the time teaches
 * people not to open it.
 */
function DepDetail({ dep }: { dep: DashboardDep }) {
  const sites = dep.declaredIn ?? [];
  const disagree = new Set(sites.map((d) => d.range)).size > 1;

  return (
    <div className="space-y-0.5">
      <DetailRow label="declared in">
        {sites.length === 0 ? (
          <span className="text-ink-3">
            not recorded — this repo was scanned before lurq tracked declaration sites
          </span>
        ) : (
          <span className="flex flex-col gap-1">
            {sites.map((site) => (
              <span key={`${site.path}:${site.range}`} className="flex flex-wrap items-baseline gap-2">
                <code className="font-mono text-xs text-ink">{site.path}</code>
                <span className="font-mono text-xs tabular-nums text-ink-3">{site.range}</span>
              </span>
            ))}
          </span>
        )}
      </DetailRow>

      {disagree && (
        <DetailRow label="note">
          These manifests declare different ranges. The summary row shows the lowest, because
          that is the one holding the repo back.
        </DetailRow>
      )}

      <DetailRow label="drift">
        {dep.resolved && dep.latest && dep.resolved !== dep.latest ? (
          <>
            a fresh install resolves to{" "}
            <span className="font-mono text-xs tabular-nums text-ink">{dep.resolved}</span>; latest
            is <span className="font-mono text-xs tabular-nums text-ink">{dep.latest}</span>
            {dep.majorsBehind > 0 && (
              <> — {dep.majorsBehind} major{dep.majorsBehind === 1 ? "" : "s"} apart</>
            )}
          </>
        ) : (
          "the declared range already admits the latest published version"
        )}
      </DetailRow>

      <DetailRow label="check">
        <code className="font-mono text-xs text-ink">lurq check-upgrade {dep.name}</code>
        <span className="text-ink-3">
          {" "}— runs in your CI and reports which call sites break
        </span>
      </DetailRow>
    </div>
  );
}
