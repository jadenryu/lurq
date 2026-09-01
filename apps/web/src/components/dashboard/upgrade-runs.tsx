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
import { DetailRow, ExpandableRow } from "@/components/dashboard/expandable-row";
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
  // failing suite, and worth showing, because it tells the reader how much the
  // green in the rest of the row is actually worth.
  if (run.testsPassed === null) {
    return <span className="font-mono text-xs text-ink-3">no suite</span>;
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
        Once the workflow runs, every upgrade it considers appears here, what it concluded, what
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
              <TableHead className="w-8 pl-3 pr-0 md:pl-4">
                <span className="sr-only">expand</span>
              </TableHead>
              <TableHead>package</TableHead>
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
                <ExpandableRow
                  key={run.id}
                  label={`${run.packageName} ${run.fromVersion} to ${run.toVersion}`}
                  colSpan={8}
                  summary={
                    <>
                      <TableCell className="font-mono text-sm">{run.packageName}</TableCell>
                      <TableCell className="font-mono text-xs tabular-nums text-muted-foreground">
                        {run.fromVersion} <span className="text-ink-3">→</span> {run.toVersion}
                      </TableCell>
                      <TableCell>
                        <Chip tone={severity.tone}>{severity.label}</Chip>
                      </TableCell>
                      <TableCell className="font-mono text-xs tabular-nums">
                        {run.callSites > 0 ? (
                          <>
                            {run.callSites}
                            {run.symbolsAffected.length > 0 && (
                              <span className="ml-1.5 text-ink-3">
                                {run.symbolsAffected.slice(0, 2).join(", ")}
                                {run.symbolsAffected.length > 2 &&
                                  ` +${run.symbolsAffected.length - 2}`}
                              </span>
                            )}
                          </>
                        ) : (
                          <span className="text-ink-3">-</span>
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
                    </>
                  }
                  detail={<RunDetail run={run} />}
                />
              );
            })}
          </TableBody>
        </Table>
      </Panel>
    </div>
  );
}

/**
 * What the run found, at full length.
 *
 * Two of these facts were already fetched and had nowhere to go: the complete
 * symbol list (the row shows two and hid the rest in a native `title`, which is
 * unreadable past a handful and unreachable on touch) and `callSiteFiles`, which
 * was carried on the type and never rendered at all.
 *
 * "Which files break" is the entire question someone has when a verdict says
 * blocking. It was one field away the whole time.
 */
function RunDetail({ run }: { run: UpgradeRun }) {
  return (
    <div className="space-y-0.5">
      {run.symbolsAffected.length > 0 && (
        <DetailRow label="symbols">
          <span className="flex flex-wrap gap-1.5">
            {run.symbolsAffected.map((sym) => (
              <code
                key={sym}
                className="rounded-[var(--radius-chip)] border border-edge px-1.5 py-0.5 font-mono text-xs text-ink"
              >
                {sym}
              </code>
            ))}
          </span>
        </DetailRow>
      )}

      {run.callSiteFiles && run.callSiteFiles.length > 0 && (
        <DetailRow label="files">
          <span className="flex flex-col gap-0.5">
            {run.callSiteFiles.map((file) => (
              <code key={file} className="font-mono text-xs text-ink">
                {file}
              </code>
            ))}
          </span>
        </DetailRow>
      )}

      {run.callSites > 0 && run.symbolsAffected.length === 0 && (
        <DetailRow label="call sites">
          {run.callSites} affected, but the run recorded no symbol names
        </DetailRow>
      )}

      {run.filesChanged !== null && (
        <DetailRow label="changed">
          {run.filesChanged} file{run.filesChanged === 1 ? "" : "s"} edited by the run
        </DetailRow>
      )}

      <DetailRow label="ci run">
        <a
          href={run.runUrl}
          target="_blank"
          rel="noreferrer"
          className="rounded-[var(--radius-chip)] underline decoration-edge underline-offset-4 outline-none transition-colors hover:text-signal focus-visible:ring-2 focus-visible:ring-signal/50"
        >
          open the workflow run
        </a>
        {run.prUrl && (
          <>
            {" · "}
            <a
              href={run.prUrl}
              target="_blank"
              rel="noreferrer"
              className="rounded-[var(--radius-chip)] underline decoration-edge underline-offset-4 outline-none transition-colors hover:text-signal focus-visible:ring-2 focus-visible:ring-signal/50"
            >
              open the pull request
            </a>
          </>
        )}
      </DetailRow>
    </div>
  );
}
