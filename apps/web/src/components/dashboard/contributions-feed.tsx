"use client";

import { useMemo, useState } from "react";
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from "@/components/ui/table";
import { Chip, EmptyState, Panel } from "@/components/dashboard/panel";
import { TableToolbar, thClass } from "@/components/dashboard/table-toolbar";
import type { DashboardContribution } from "@/lib/lurq-issuer";

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

/** Read-only: packages the signed-in user's queries first added to the index. */
export function ContributionsFeed({ packages }: { packages: DashboardContribution[] }) {
  const [query, setQuery] = useState("");

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return packages;
    return packages.filter(
      (p) => p.name.toLowerCase().includes(q) || (p.category ?? "").toLowerCase().includes(q),
    );
  }, [packages, query]);

  return (
    <div className="space-y-4">
      <TableToolbar
        query={query}
        onQueryChange={setQuery}
        placeholder="Search by package or category…"
        count={visible.length}
        noun="package"
      />

      {packages.length === 0 ? (
        <EmptyState title="No contributions yet">
          Credited when your query is the first to pull a package into the index.
        </EmptyState>
      ) : visible.length === 0 ? (
        <EmptyState title="No matches" />
      ) : (
        <Panel padding="none" className="overflow-hidden">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="border-border/60 hover:bg-transparent">
                  <TableHead className={thClass}>Package</TableHead>
                  <TableHead className={thClass}>Category</TableHead>
                  <TableHead className={thClass}>Health</TableHead>
                  <TableHead className={thClass}>Added</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {visible.map((p) => (
                  <TableRow key={p.name} className="border-border/60">
                    <TableCell className="whitespace-nowrap font-mono text-sm font-medium">
                      {p.name}
                    </TableCell>
                    <TableCell>
                      {p.category ? (
                        <Chip>{p.category}</Chip>
                      ) : (
                        <span className="text-muted-foreground">-</span>
                      )}
                    </TableCell>
                    <TableCell className="font-mono text-sm tabular-nums text-muted-foreground">
                      {p.healthScore ?? "-"}
                    </TableCell>
                    <TableCell className="whitespace-nowrap font-mono text-xs text-muted-foreground">
                      {formatDate(p.firstRequestedAt)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </Panel>
      )}
    </div>
  );
}
