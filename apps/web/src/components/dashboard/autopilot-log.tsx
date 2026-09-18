import Link from "next/link";
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
 * Every autopilot run, across every repository.
 *
 * The per-repo table answers "what happened to this repo". This answers the
 * question that comes first and had nowhere to go: I armed the autopilot, so
 * what has lurq actually done? Without it, a user whose workflow was never
 * committed sees an empty repo page and concludes the product is broken — the
 * failure is indistinguishable from "nothing needed doing".
 *
 * The vocabulary is deliberately the same as `upgrade-runs.tsx`: severity is
 * what the check CONCLUDED, status is what the run DID, and `unverified` keeps
 * its own tone rather than sharing one with `ok`. Two tables of the same rows
 * using different words for the same state would be worse than one table.
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

/**
 * Why the run started, in the user's words rather than GitHub's event names.
 *
 * `dispatch` says "a release, or you" because that is exactly what lurq can
 * establish: the workflow sees one `workflow_dispatch` event whether lurq's API
 * call or a person's button press produced it. Splitting them in the UI would
 * be asserting a cause nothing recorded.
 */
const TRIGGER: Record<NonNullable<UpgradeRun["trigger"]>, string> = {
  schedule: "on schedule",
  dispatch: "a new release, or you",
  push: "a push",
  pull_request: "a pull request",
  other: "another event",
};

function TriggerCell({ run }: { run: UpgradeRun }) {
  // Null is every row written before the column existed, and every run posted
  // outside Actions. Saying "not recorded" costs a column's width; guessing
  // `schedule` would make the log assert something it never observed.
  if (!run.trigger) {
    return <span className="font-mono text-xs text-ink-3">not recorded</span>;
  }
  return <span className="text-xs text-ink-2">{TRIGGER[run.trigger]}</span>;
}

function TestsCell({ run }: { run: UpgradeRun }) {
  // "no suite" is not "passed": it tells the reader how much the green in the
  // rest of the row is actually worth.
  if (run.testsPassed === null) {
    return <span className="font-mono text-xs text-ink-3">no suite</span>;
  }
  return (
    <span className={`font-mono text-xs ${run.testsPassed ? "text-ok" : "text-bad"}`}>
      {run.testsPassed ? "passed" : "failed"}
    </span>
  );
}

export function AutopilotLog({ runs, armed }: { runs: UpgradeRun[]; armed: number }) {
  if (runs.length === 0) {
    /**
     * The empty state has to distinguish two cases, because they have nothing
     * in common except looking identical here.
     *
     * Armed with no runs is the one that wastes people's time: the policy is
     * saved, the dashboard says armed, and nothing will ever happen because the
     * workflow file was never committed. Arming in the web app cannot start a
     * run on its own — that is the single most misleading thing about this
     * feature, so the empty state says it outright.
     */
    return armed > 0 ? (
      <EmptyState title="Armed, but nothing has run yet">
        {armed === 1 ? "One repository is" : `${armed} repositories are`} set to act, and no run
        has ever reported in. Turning autopilot on here saves the policy — it cannot start
        anything by itself. The workflow file has to be committed to the repository, which you do
        from the repository page, and it runs on a schedule after that.{" "}
        <Link href="/dashboard/repos" className="underline underline-offset-4">
          Add the workflow
        </Link>
        .
      </EmptyState>
    ) : (
      <EmptyState title="No autopilot runs yet">
        Arm a repository and commit its workflow, and every upgrade it considers appears here:
        what it concluded, what it changed, whether your tests passed, and why the run started.
      </EmptyState>
    );
  }

  const delivered = runs.filter((r) => r.status === "pr_open" || r.status === "merged").length;
  const caught = runs.filter((r) => r.severity === "blocking").length;

  return (
    <div className="space-y-4">
      <PanelHeader
        title="every run"
        trailing={
          <span className="font-mono text-xs text-ink-2">
            {runs.length} run{runs.length === 1 ? "" : "s"}
            {caught > 0 && ` · ${caught} caught before merge`}
            {delivered > 0 && ` · ${delivered} reached a pull request`}
          </span>
        }
      />

      <Panel padding="none" className="overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow className="border-border">
              <TableHead className="pl-5 md:pl-6">package</TableHead>
              <TableHead>concluded</TableHead>
              <TableHead>did</TableHead>
              <TableHead>why it ran</TableHead>
              <TableHead>tests</TableHead>
              <TableHead className="pr-5 text-right md:pr-6">when</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {runs.map((run) => (
              <TableRow key={run.id} className="border-border">
                <TableCell className="pl-5 md:pl-6">
                  <span className="font-mono text-sm">{run.packageName}</span>
                  <span className="ml-2 font-mono text-[11px] text-ink-3">
                    {run.fromVersion} → {run.toVersion}
                  </span>
                  {run.callSites > 0 && (
                    <span className="ml-2 text-[11px] text-ink-3">
                      {run.callSites} call site{run.callSites === 1 ? "" : "s"}
                    </span>
                  )}
                </TableCell>
                <TableCell>
                  <Chip tone={SEVERITY[run.severity].tone}>{SEVERITY[run.severity].label}</Chip>
                </TableCell>
                <TableCell>
                  {/* The PR is the outcome people want to click, so the status
                      chip itself is the link when there is one. */}
                  {run.prUrl ? (
                    <a href={run.prUrl} target="_blank" rel="noreferrer">
                      <Chip tone={STATUS[run.status].tone}>{STATUS[run.status].label}</Chip>
                    </a>
                  ) : (
                    <Chip tone={STATUS[run.status].tone}>{STATUS[run.status].label}</Chip>
                  )}
                </TableCell>
                <TableCell>
                  <TriggerCell run={run} />
                </TableCell>
                <TableCell>
                  <TestsCell run={run} />
                </TableCell>
                <TableCell className="pr-5 text-right md:pr-6">
                  {/* Links to the real Actions logs: the log states what lurq
                      concluded, and this is where you check it. */}
                  {run.runUrl ? (
                    <a
                      href={run.runUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="font-mono text-xs text-ink-2 hover:text-signal"
                    >
                      {relativeTime(run.createdAt)}
                    </a>
                  ) : (
                    <span className="font-mono text-xs text-ink-2">
                      {relativeTime(run.createdAt)}
                    </span>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Panel>
    </div>
  );
}
