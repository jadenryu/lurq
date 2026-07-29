import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";
import type { DashboardContribution } from "@/lib/lurq-issuer";

const chipClass = "rounded-sm border px-2 py-0.5 font-mono text-[0.65rem] uppercase tracking-wide";
const headClass = "font-mono text-xs font-normal uppercase tracking-wide text-muted-foreground/70";

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

/** Read-only: packages the signed-in user's queries first added to the index. */
export function ContributionsFeed({ packages }: { packages: DashboardContribution[] }) {
  if (packages.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        Nothing yet — evaluate, compare, or verify a package no one has asked lurq about before,
        and it shows up here.
      </p>
    );
  }

  return (
    <Table>
      <TableHeader>
        <TableRow className="border-border/60 hover:bg-transparent">
          <TableHead className={headClass}>Package</TableHead>
          <TableHead className={headClass}>Category</TableHead>
          <TableHead className={headClass}>Health</TableHead>
          <TableHead className={headClass}>Added</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {packages.map((p) => (
          <TableRow key={p.name} className="border-border/60">
            <TableCell className="font-mono text-sm font-medium">{p.name}</TableCell>
            <TableCell>
              {p.category ? (
                <span className={cn(chipClass, "border-border text-muted-foreground")}>
                  {p.category}
                </span>
              ) : (
                <span className="text-muted-foreground">—</span>
              )}
            </TableCell>
            <TableCell className="font-mono text-sm tabular-nums text-muted-foreground">
              {p.healthScore ?? "—"}
            </TableCell>
            <TableCell className="font-mono text-xs text-muted-foreground">
              {formatDate(p.firstRequestedAt)}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
