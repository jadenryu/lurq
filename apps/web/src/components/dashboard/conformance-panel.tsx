import Link from "next/link";
import { EmptyState, Panel, PanelHeader, eyebrow } from "@/components/dashboard/panel";
import { cn } from "@/lib/utils";
import type { ConformanceReport, RepoConformance } from "@/lib/lurq-issuer";

/**
 * The policy, run backwards over the repos that already exist.
 *
 * Setting a rule tells you what agents may add next. It says nothing about the
 * four services that shipped a GPL parser last spring, and that gap is what
 * makes a policy feel decorative — you write it, nothing visibly happens, and
 * you never learn who was already breaking it. This is the other half: same
 * rules, applied to what is on disk today.
 *
 * It reports and links; it never offers to fix. Rewriting someone's manifest
 * from a settings page would be a write nobody asked for, and the repo's
 * autopilot is where an actual change gets proposed, reviewed and merged.
 */

/** Rule → how it reads in a row. Kept as words, not colour: the rules differ in
 *  kind, not severity, and a red/amber ramp would invent a ranking we don't have. */
const RULE_LABEL: Record<string, string> = {
  denied: "denied",
  license: "licence",
  deprecated: "deprecated",
  confidence: "evidence",
};

function RepoRow({ repo }: { repo: RepoConformance }) {
  const clean = repo.total === 0;
  return (
    <div className="border-b border-border/60 py-4 last:border-0">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <Link
          href={`/dashboard/repos/${repo.repoId}`}
          className="font-mono text-sm text-foreground transition-colors hover:text-signal"
        >
          {repo.fullName}
        </Link>
        <span
          className={cn(
            "font-mono text-xs tabular-nums",
            clean ? "text-muted-foreground" : "text-foreground",
          )}
        >
          {clean ? "no violations" : `${repo.total} violation${repo.total === 1 ? "" : "s"}`}
        </span>
      </div>

      {/* The denominator, always. "0 violations" over an unstated base is the
          all-clear this codebase refuses to imply anywhere else — a repo whose
          dependencies are mostly unindexed has not been cleared, it has barely
          been read. */}
      <p className={cn(eyebrow, "mt-1")}>
        {repo.checked.toLocaleString()} dependencies ruled on
        {repo.unchecked > 0 && ` · ${repo.unchecked.toLocaleString()} not in the index, unruled`}
        {repo.unscored > 0 && ` · ${repo.unscored.toLocaleString()} ungraded, evidence rule abstained`}
      </p>

      {repo.violations.length > 0 && (
        <ul className="mt-3 space-y-1.5">
          {repo.violations.map((v) => (
            <li key={`${v.name}-${v.rule}`} className="flex flex-wrap items-baseline gap-x-2.5">
              {/* The violating package, linked to its own row in that repo's
                  drift table. A rule violation names a package and then made
                  you go find it in a list of two hundred. */}
              <Link
                href={`/dashboard/repos/${repo.repoId}?q=${encodeURIComponent(v.name)}#deps`}
                className="rounded-[var(--radius-chip)] font-mono text-xs text-foreground outline-none transition-colors hover:text-signal focus-visible:ring-2 focus-visible:ring-signal/50"
              >
                {v.name}
              </Link>
              <span className="rounded-sm bg-muted px-1.5 py-0.5 font-mono text-[0.65rem] uppercase tracking-[0.12em] text-ink-3">
                {RULE_LABEL[v.rule] ?? v.rule}
              </span>
              <span className="text-xs text-muted-foreground">{v.reason}</span>
            </li>
          ))}
          {repo.total > repo.violations.length && (
            // Was a dead end: it told you more violations existed and gave you
            // nowhere to see them.
            <li>
              <Link
                href={`/dashboard/repos/${repo.repoId}`}
                className={cn(eyebrow, "rounded-[var(--radius-chip)] outline-none transition-colors hover:text-signal focus-visible:ring-2 focus-visible:ring-signal/50")}
              >
                … {(repo.total - repo.violations.length).toLocaleString()} more in {repo.fullName}
              </Link>
            </li>
          )}
        </ul>
      )}
    </div>
  );
}

export function ConformancePanel({ report }: { report: ConformanceReport }) {
  // No rules means nothing was evaluated. Rendering an empty list here would
  // read as "every repo passes", which is the one thing it definitely does not
  // mean — hence a prompt to set a rule rather than a clean bill of health.
  if (!report.enforcing) {
    return (
      <EmptyState title="No rules are in force yet">
        Set a rule above and this becomes a list of the repositories that already break it.
      </EmptyState>
    );
  }

  if (report.repos.length === 0) {
    return (
      <EmptyState title="No repositories connected">
        Rules are enforced for every agent using your key already. Connect a repository to
        also see what your existing code would fail.{" "}
        <Link href="/dashboard/repos" className="underline underline-offset-4">
          Connect one
        </Link>
        .
      </EmptyState>
    );
  }

  const failing = report.repos.filter((r) => r.total > 0).length;
  const violations = report.repos.reduce((sum, r) => sum + r.total, 0);

  return (
    <Panel>
      <PanelHeader
        title="what your repos would fail"
        trailing={
          <span className="font-mono text-[0.65rem] uppercase tracking-[0.16em] text-ink-3">
            {failing} of {report.repos.length} repos · {violations} violations
          </span>
        }
      />
      <div className="mt-2">
        {report.repos.map((repo) => (
          <RepoRow key={repo.repoId} repo={repo} />
        ))}
      </div>
      <p className={cn(eyebrow, "mt-4")}>
        Read against your current rules every time this page loads, so relaxing a rule clears
        the list immediately. Nothing here changes a manifest.
      </p>
    </Panel>
  );
}
