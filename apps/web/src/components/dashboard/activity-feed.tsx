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
import { relativeTime } from "@/lib/format";
import type { DashboardOutcome } from "@/lib/lurq-issuer";

const BUILD_SIGNAL_LABEL: Record<string, string> = {
  installed: "Installed",
  compiled: "Compiled",
  tests_passed: "Tests passed",
  failed: "Failed",
};

const FILTERS = [
  { id: "all", label: "all" },
  { id: "accepted", label: "accepted" },
  { id: "passed", label: "passed" },
];

/** Read-only: the signed-in user's `recommendation_outcomes` history. */
export function ActivityFeed({ outcomes }: { outcomes: DashboardOutcome[] }) {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("all");

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return outcomes.filter((o) => {
      if (filter === "accepted" && !o.accepted) return false;
      if (filter === "passed" && o.accepted) return false;
      if (!q) return true;
      return o.packageName.toLowerCase().includes(q) || (o.need ?? "").toLowerCase().includes(q);
    });
  }, [outcomes, query, filter]);

  return (
    <div className="space-y-4">
      <TableToolbar
        query={query}
        onQueryChange={setQuery}
        placeholder="Search by package or need…"
        filters={FILTERS}
        activeFilter={filter}
        onFilterChange={setFilter}
        count={visible.length}
        noun="recommendation"
      />

      {outcomes.length === 0 ? (
        <EmptyState title="No recommendations yet">
          Appears once your agent reports back on a package it was given.
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
                  <TableHead className={thClass}>Decision</TableHead>
                  <TableHead className={thClass}>Build</TableHead>
                  <TableHead className={thClass}>Need</TableHead>
                  <TableHead className={thClass}>When</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {visible.map((o, i) => (
                  <TableRow key={`${o.packageName}-${o.createdAt}-${i}`} className="border-border/60">
                    <TableCell className="whitespace-nowrap font-mono text-sm font-medium">
                      {o.packageName}
                    </TableCell>
                    <TableCell>
                      <Chip tone={o.accepted ? "good" : "neutral"} dot>
                        {o.accepted ? "Accepted" : "Passed"}
                      </Chip>
                    </TableCell>
                    <TableCell>
                      {o.buildSignal ? (
                        <Chip tone={o.buildSignal === "failed" ? "bad" : "good"}>
                          {BUILD_SIGNAL_LABEL[o.buildSignal] ?? o.buildSignal}
                        </Chip>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell className="max-w-[18rem]">
                      {o.need ? (
                        <span className="line-clamp-2 text-sm text-muted-foreground">{o.need}</span>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell className="whitespace-nowrap font-mono text-xs text-muted-foreground">
                      {relativeTime(o.createdAt)}
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
