import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";
import type { DashboardOutcome } from "@/lib/lurq-issuer";

function relativeTime(iso: string): string {
  const minutes = Math.floor((Date.now() - new Date(iso).getTime()) / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(iso).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

const BUILD_SIGNAL_LABEL: Record<string, string> = {
  installed: "Installed",
  compiled: "Compiled",
  tests_passed: "Tests passed",
  failed: "Failed",
};

const chipClass =
  "rounded-sm border px-2 py-0.5 font-mono text-[0.65rem] uppercase tracking-wide";
const headClass = "font-mono text-xs font-normal uppercase tracking-wide text-muted-foreground/70";

/** Read-only: renders the signed-in user's recommendation_outcomes history. */
export function ActivityFeed({ outcomes }: { outcomes: DashboardOutcome[] }) {
  if (outcomes.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No recommendations yet — connect a client and ask lurq for a package.
      </p>
    );
  }

  return (
    <Table>
      <TableHeader>
        <TableRow className="border-border/60 hover:bg-transparent">
          <TableHead className={headClass}>Package</TableHead>
          <TableHead className={headClass}>Decision</TableHead>
          <TableHead className={headClass}>Build</TableHead>
          <TableHead className={headClass}>Need</TableHead>
          <TableHead className={headClass}>When</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {outcomes.map((o, i) => (
          <TableRow key={`${o.packageName}-${o.createdAt}-${i}`} className="border-border/60">
            <TableCell className="font-mono text-sm font-medium">{o.packageName}</TableCell>
            <TableCell>
              <span
                className={cn(
                  chipClass,
                  o.accepted ? "border-foreground/25 text-foreground" : "border-border text-muted-foreground/70",
                )}
              >
                {o.accepted ? "Accepted" : "Passed"}
              </span>
            </TableCell>
            <TableCell>
              {o.buildSignal ? (
                <span
                  className={cn(
                    chipClass,
                    o.buildSignal === "failed"
                      ? "border-destructive/40 text-destructive"
                      : "border-border text-muted-foreground",
                  )}
                >
                  {BUILD_SIGNAL_LABEL[o.buildSignal] ?? o.buildSignal}
                </span>
              ) : (
                <span className="text-muted-foreground">—</span>
              )}
            </TableCell>
            <TableCell className="max-w-[16rem] truncate text-muted-foreground">
              {o.need ?? "—"}
            </TableCell>
            <TableCell className="font-mono text-xs text-muted-foreground">
              {relativeTime(o.createdAt)}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
