import { Chip, EmptyState, Panel, PanelHeader } from "@/components/dashboard/panel";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { relativeTime } from "@/lib/format";
import type { UpgradeRun } from "@/lib/lurq-issuer";

/**
 * Severity is what the CI check concluded, and `unverified` gets its own tone
 * rather than sharing one with `ok`. The whole point of the check is that "we
 * could not establish this" and "we established it is fine" are different
 * answers; a table that colours them alike undoes that in one glance.
 */
const SEVERITY: Record<UpgradeRun["severity"], { label: string; tone: "bad" | "warn" | "good" | "neutral" }> = {
  blocking: { label: "would break", tone: "bad" },
  warning: { label: "signature", tone: "warn" },
  ok: { label: "safe", tone: "good" },
  unverified: { label: "unverified", tone: "neutral" },
};

const STATUS: Record<UpgradeRun["status"], { label: string; tone: "bad" | "warn" | "good" | "accent" | "neutral" }> = {
  checked: { label: "analysed", tone: "neutral" },
  skipped: { label: "skipped", tone: "neutral" },
  edited: { label: "edited", tone: "warn" },
  pr_open: { label: "pr open", tone: "accent" },
  merged: { label: "merged", tone: "good" },
  failed: { label: "failed", tone: "bad" },
};

function TestsCell({ run }: { run: UpgradeRun }) {
  // Null is "this repo has no test script", which is genuinely different from a
  // failing suite — and worth showing, because it tells the reader how much the
  // green in the rest of the row is actually worth.
  if (run.testsPassed === null) {
    return <span className="font-mono text-xs text-muted-foreground/50">no suite</span>;
  }
  return (
    <span className={`font-mono text-xs ${run.testsPassed ? "text-ok" : "text-bad"}`}>
      {run.testsPassed ? "passed" : "failed"}
    </span>
  );
}

export function UpgradeRuns({ runs }: { runs: UpgradeRun[] }) {
  if (runs.length === 0) {
    return (
      <EmptyState title="No autopilot runs yet">
        Once the workflow runs, every upgrade it considers appears here — what it concluded, what
        it changed, and whether your tests passed.
      </EmptyState>
    );
  }

  const caught = runs.filter((r) => r.severity === "blocking");
  const callSites = caught.reduce((sum, r) => sum + r.callSites, 0);

  return (
    <div className="space-y-4">
      <PanelHeader
        title="autopilot runs"
        trailing={
          <span className="font-mono text-xs text-muted-foreground">
            {caught.length} caught before merge
            {callSites > 0 && ` · ${callSites} call sites`}
          </span>
        }
      />

      <Panel padding="none" className="overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow className="border-border">
              <TableHead className="pl-5 md:pl-6">package</TableHead>
              <TableHead>upgrade</TableHead>
              <TableHead>verdict</TableHead>
              <TableHead>call sites</TableHead>
              <TableHead>tests</TableHead>
              <TableHead>result</TableHead>
              <TableHead className="pr-5 md:pr-6">when</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {runs.map((run) => {
              const severity = SEVERITY[run.severity];
              const status = STATUS[run.status];
              return (
                <TableRow key={run.id} className="border-border">
                  <TableCell className="pl-5 font-mono text-sm md:pl-6">
                    {run.packageName}
                  </TableCell>
                  <TableCell className="font-mono text-xs tabular-nums text-muted-foreground">
                    {run.fromVersion} <span className="text-muted-foreground/50">→</span>{" "}
                    {run.toVersion}
                  </TableCell>
                  <TableCell>
                    <Chip tone={severity.tone}>{severity.label}</Chip>
                  </TableCell>
                  <TableCell className="font-mono text-xs tabular-nums">
                    {run.callSites > 0 ? (
                      <span title={run.symbolsAffected.join(", ")}>
                        {run.callSites}
                        {run.symbolsAffected.length > 0 && (
                          <span className="ml-1.5 text-muted-foreground/60">
                            {run.symbolsAffected.slice(0, 2).join(", ")}
                            {run.symbolsAffected.length > 2 &&
                              ` +${run.symbolsAffected.length - 2}`}
                          </span>
                        )}
                      </span>
                    ) : (
                      <span className="text-muted-foreground/40">—</span>
                    )}
                  </TableCell>
                  <TableCell>
                    <TestsCell run={run} />
                  </TableCell>
                  <TableCell>
                    {run.prUrl ? (
                      <a href={run.prUrl} target="_blank" rel="noreferrer">
                        <Chip tone={status.tone}>{status.label}</Chip>
                      </a>
                    ) : (
                      <Chip tone={status.tone}>{status.label}</Chip>
                    )}
                  </TableCell>
                  <TableCell className="pr-5 font-mono text-xs text-muted-foreground md:pr-6">
                    {relativeTime(run.createdAt)}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </Panel>
    </div>
  );
}
