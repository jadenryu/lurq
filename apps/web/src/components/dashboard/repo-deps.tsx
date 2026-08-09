"use client";

import { useMemo, useState } from "react";
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
  const [filter, setFilter] = useState("all");

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
    <div className="space-y-4">
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
              <TableHead className="pl-5 md:pl-6">package</TableHead>
              <TableHead>declared</TableHead>
              <TableHead>resolves to</TableHead>
              <TableHead>latest</TableHead>
              <TableHead className="pr-5 md:pr-6">status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((dep) => (
              <TableRow key={dep.name} className="border-border">
                <TableCell className="pl-5 font-mono text-sm md:pl-6">{dep.name}</TableCell>
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
                  <span className="flex flex-wrap items-center gap-1.5">
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
                    {dep.majorsBehind === 0 &&
                      !dep.deprecated &&
                      dep.advisories === 0 &&
                      (dep.resolved === dep.latest ? (
                        <Chip tone="good">current</Chip>
                      ) : (
                        <Chip tone="neutral">minor behind</Chip>
                      ))}
                  </span>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Panel>
    </div>
  );
}
