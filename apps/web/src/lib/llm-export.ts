// Relative, and types only: tests/llmExport.test.ts imports this file from the
// repo root, where `@/` does not resolve and the root tsc would fail.
import type { AuditEvent } from "./audit-types";
import type {
  ConformanceReport,
  DashboardDep,
  RepoAlert,
  RepoDetailPayload,
  SelectionPolicy,
  StackConflict,
  TransitiveRisk,
} from "./lurq-issuer";

/**
 * The dashboard's findings, as a brief you can paste into a coding agent.
 *
 * The whole product is a loop that ends in an agent editing a manifest, and
 * until now the last mile of that loop was a human reading a table and retyping
 * it into a chat window. Every number on these pages already knows the package,
 * the range, the file it is declared in and why it is flagged; an export is that
 * same record, addressed to the reader who is actually going to do the work.
 *
 * Written for a model, so three rules hold throughout:
 *
 *  1. **Facts before instructions.** The brief states what was found, then what
 *     to do about it. A model handed "fix these" first will start editing before
 *     it has read the constraints.
 *  2. **Never imply an all-clear.** Anything unscanned, unindexed or unknown is
 *     named as such. A brief that lists three findings and stops reads as "and
 *     the rest is fine", which is the one claim this codebase refuses to make
 *     anywhere else — so it must not make it here either.
 *  3. **No invented severity.** Ranking is by the evidence we have (advisories,
 *     then majors behind), never by a score this file made up to look decisive.
 *
 * Markdown, not JSON: every model reads it, a human can sanity-check it before
 * pasting, and it survives the reflow that a chat box does to long lines.
 */

const RULE = "---";

/** `1.2.3 → 4.0.0`, or just the range when there is nothing to move to. */
function move(from: string | null, to: string | null): string {
  if (!from && !to) return "unknown";
  if (!to) return `${from} (no newer release on record)`;
  if (!from) return `→ ${to}`;
  return `${from} → ${to}`;
}

function bullet(parts: (string | null | undefined | false)[]): string {
  return `- ${parts.filter(Boolean).join(" · ")}`;
}

/** Deps worth an agent's attention, worst evidence first. */
function ranked(deps: DashboardDep[]): DashboardDep[] {
  return deps
    .filter((d) => d.advisories > 0 || d.deprecated || d.majorsBehind > 0)
    .sort(
      (a, b) =>
        b.advisories - a.advisories ||
        Number(b.deprecated) - Number(a.deprecated) ||
        b.majorsBehind - a.majorsBehind ||
        a.name.localeCompare(b.name),
    );
}

function depLine(dep: DashboardDep): string {
  const flags = [
    dep.advisories > 0 && `${dep.advisories} advisor${dep.advisories === 1 ? "y" : "ies"}`,
    dep.deprecated && "deprecated",
    dep.majorsBehind > 0 && `${dep.majorsBehind} major${dep.majorsBehind === 1 ? "" : "s"} behind`,
  ];
  // Where it is declared is the part that saves the agent a grep, and in a
  // monorepo it is the difference between one edit and twelve.
  const where = dep.declaredIn?.length
    ? dep.declaredIn.map((m) => `${m.path} (${m.range})`).join(", ")
    : `declared as ${dep.range}`;
  return bullet([`\`${dep.name}\` ${move(dep.resolved, dep.latest)}`, ...flags, where]);
}

function conflictLine(conflict: StackConflict): string {
  return bullet([
    `\`${conflict.packages.join("\` + \`")}\``,
    conflict.source,
    conflict.detail,
    conflict.requirement &&
      `needs ${conflict.requirement.peer}@${conflict.requirement.range}, resolved ${conflict.requirement.resolved ?? "nothing"}`,
  ]);
}

function riskLine(risk: TransitiveRisk): string {
  return bullet([
    `\`${risk.name}\`@${risk.version}`,
    risk.advisories > 0 &&
      `${risk.advisories} advisor${risk.advisories === 1 ? "y" : "ies"}`,
    risk.deprecated && "deprecated",
    risk.latest && `latest ${risk.latest}`,
    risk.pulledInBy.length
      ? `pulled in by ${risk.pulledInBy.map((p) => `\`${p}\``).join(", ")}`
      : "no attributed parent — upgrade target unknown",
  ]);
}

/**
 * One repository, as a brief.
 *
 * The header states the scan's own age and coverage before any finding, because
 * a list of six problems from a scan that last ran in March is a different
 * document from the same list run this morning, and only one of them should be
 * acted on unread.
 */
export function repoBrief(repo: RepoDetailPayload): string {
  const drift = repo.drift;
  const flagged = ranked(repo.deps);
  const uncovered = drift ? drift.depsDeclared - drift.depsTracked : 0;

  const out: string[] = [
    `# Dependency findings — ${repo.fullName}`,
    "",
    "Produced by lurq. Facts first, then the task. Do not treat anything absent",
    "from this brief as verified: it is either fine, unindexed, or not looked at,",
    "and the coverage line below says which.",
    "",
    `- Repository: ${repo.fullName}${repo.defaultBranch ? ` (${repo.defaultBranch})` : ""}`,
    `- Last scanned: ${repo.lastScanAt ?? "never"}`,
  ];

  if (repo.lastScanError) {
    out.push(`- Last scan FAILED: ${repo.lastScanError} — findings below may be stale.`);
  }
  if (drift) {
    out.push(
      `- Coverage: ${drift.depsTracked} of ${drift.depsDeclared} declared dependencies are in the index` +
        (uncovered > 0 ? `; ${uncovered} are not, and no claim is made about them` : ""),
    );
  } else {
    out.push("- Coverage: this repo has no completed scan, so nothing below is exhaustive.");
  }

  out.push("", RULE, "", "## Direct dependencies to address", "");
  if (flagged.length === 0) {
    out.push(
      "None of the indexed direct dependencies carry an advisory, a deprecation or a major behind.",
    );
  } else {
    out.push(...flagged.map(depLine));
  }

  if (repo.conflicts === null) {
    out.push("", "## Stack conflicts", "", "Not checked — this repo predates the conflict check.");
  } else if (repo.conflicts.length > 0) {
    out.push("", "## Stack conflicts", "", ...repo.conflicts.map(conflictLine));
  }

  if (repo.transitiveRisks.length > 0) {
    out.push(
      "",
      "## Transitive risks",
      "",
      "These are not in the manifest. Fix them by moving the direct dependency that pulls them in.",
      "",
      ...repo.transitiveRisks.map(riskLine),
    );
  }

  out.push(
    "",
    RULE,
    "",
    "## Task",
    "",
    "1. Start with anything carrying an advisory; those outrank version drift.",
    "2. For each package, check the changelog between the two versions before editing a range.",
    "3. Edit the manifest at the path given, not a guess at where it lives.",
    "4. Run the test suite. Report anything you did not upgrade and why.",
    "",
    "Do not upgrade a package this brief does not name.",
    "",
  );

  return out.join("\n");
}

/**
 * A slice of the audit log, as a brief.
 *
 * Takes whatever the reader is currently looking at rather than the whole log:
 * they have already narrowed it to the failing scans in the last week, and an
 * export that silently re-widens that to everything is a different document from
 * the one they asked for. The filter is stated in the header so the recipient
 * knows what was left out.
 */
export function auditBrief(
  events: AuditEvent[],
  filter: { range: string; kind: string; severity: string; query: string },
): string {
  const out: string[] = [
    "# Workspace event log — lurq",
    "",
    `Filtered view: ${filter.range}, kind ${filter.kind}, ${filter.severity}` +
      (filter.query ? `, matching "${filter.query}"` : "") +
      ". Events outside that filter are not included.",
    "",
  ];

  if (events.length === 0) {
    out.push("No events match.");
    return out.join("\n");
  }

  const problems = events.filter((e) => e.tone !== "neutral");
  if (problems.length > 0) {
    out.push("## Needs attention", "");
    out.push(
      ...problems.map((e) =>
        bullet([e.at, e.kind, e.summary, e.detail, e.tone === "bad" ? "ACTION NEEDED" : "review"]),
      ),
    );
    out.push("");
  }

  const rest = events.filter((e) => e.tone === "neutral");
  if (rest.length > 0) {
    out.push("## Everything else, newest first", "");
    out.push(...rest.map((e) => bullet([e.at, e.kind, e.summary, e.detail])));
    out.push("");
  }

  out.push(
    RULE,
    "",
    "## Task",
    "",
    "1. Work the 'needs attention' entries; a failed scan means the findings for",
    "   that repository are stale or missing entirely, so fix those first.",
    "2. For a breaking release already admitted by a declared range, the next",
    "   clean install takes it — treat it as already broken, not as upcoming.",
    "3. Report anything you could not resolve. Do not silently skip.",
    "",
  );

  return out.join("\n");
}

/**
 * Everything flagged across the workspace.
 *
 * Ordered the way an engineer triages: what is already broken (failed scans),
 * what is about to break (alerts whose range already admits the release), then
 * the standing policy violations. Repos with nothing to say are listed by name
 * at the end rather than omitted — "not mentioned" and "clean" have to be
 * distinguishable.
 */
export function workspaceBrief({
  conformance,
  alerts,
  repos,
  policy,
}: {
  conformance: ConformanceReport;
  alerts: RepoAlert[];
  repos: { fullName: string; lastScanAt: string | null; lastScanError: string | null }[];
  policy: SelectionPolicy | null;
}): string {
  const failedScans = repos.filter((r) => r.lastScanError);
  const neverScanned = repos.filter((r) => !r.lastScanAt);
  const landed = alerts.filter((a) => a.inRange);
  const pending = alerts.filter((a) => !a.inRange);
  const offenders = conformance.repos.filter((r) => r.total > 0);
  const clean = conformance.repos.filter((r) => r.total === 0);

  const out: string[] = [
    "# Workspace findings — lurq",
    "",
    "Facts first, then the task. Nothing here is a clean bill of health for",
    "anything it does not mention.",
    "",
  ];

  if (failedScans.length > 0) {
    out.push("## Scans that failed", "");
    out.push(...failedScans.map((r) => bullet([`\`${r.fullName}\``, r.lastScanError])));
    out.push("", "Findings for these repositories are stale or missing entirely.", "");
  }

  out.push("## Breaking releases on declared dependencies", "");
  if (alerts.length === 0) {
    out.push("None recorded.");
  } else {
    if (landed.length > 0) {
      out.push("Already admitted by the declared range — the next clean install takes them:", "");
      out.push(
        ...landed.map((a) =>
          bullet([
            `\`${a.packageName}\` ${a.fromVersion ?? "?"} → ${a.toVersion}`,
            `in ${a.repoFullName}`,
            `range ${a.range}`,
          ]),
        ),
      );
      out.push("");
    }
    if (pending.length > 0) {
      out.push("Held back by the declared range, but waiting:", "");
      out.push(
        ...pending.map((a) =>
          bullet([
            `\`${a.packageName}\` → ${a.toVersion}`,
            `in ${a.repoFullName}`,
            `range ${a.range} holds at ${a.fromVersion ?? "unknown"}`,
          ]),
        ),
      );
    }
  }

  out.push("", RULE, "", "## Selection policy violations", "");
  if (!conformance.enforcing) {
    out.push("No selection policy is in force, so no dependency was ruled on.");
  } else if (offenders.length === 0) {
    out.push("Every ruled dependency passes the policy in force.");
  } else {
    for (const repo of offenders) {
      out.push(
        `### ${repo.fullName} — ${repo.total} violation${repo.total === 1 ? "" : "s"}`,
        "",
        ...repo.violations.map((v) => bullet([`\`${v.name}\``, v.rule, v.reason])),
      );
      if (repo.total > repo.violations.length) {
        out.push(`- …and ${repo.total - repo.violations.length} more not listed here.`);
      }
      out.push(
        `- Coverage: ${repo.checked} ruled, ${repo.unchecked} not in the index (no claim made)` +
          (repo.unscored > 0 ? `, ${repo.unscored} ungraded so the evidence rule abstained` : ""),
        "",
      );
    }
  }

  if (policy) {
    out.push(RULE, "", "## The policy these were ruled against", "");
    out.push(
      ...[
        policy.deny.length > 0 &&
          bullet(["Blocked", policy.deny.map((d) => `\`${d.name}\``).join(", ")]),
        policy.allow.length > 0 &&
          bullet(["Always allowed", policy.allow.map((a) => `\`${a}\``).join(", ")]),
        policy.minConfidence && bullet([`Minimum evidence: ${policy.minConfidence}`]),
        policy.licenses && bullet([`Allowed licences: ${policy.licenses.join(", ") || "none"}`]),
        policy.blockDeprecated && bullet(["Deprecated packages refused"]),
      ].filter((line): line is string => Boolean(line)),
    );
    out.push("", "Respect these when choosing a replacement package.", "");
  }

  if (clean.length > 0 || neverScanned.length > 0) {
    out.push(RULE, "", "## Coverage", "");
    if (clean.length > 0) {
      out.push(bullet(["Ruled and clean", clean.map((r) => r.fullName).join(", ")]));
    }
    if (neverScanned.length > 0) {
      out.push(
        bullet([
          "Never scanned — nothing is known about these",
          neverScanned.map((r) => r.fullName).join(", "),
        ]),
      );
    }
    out.push("");
  }

  out.push(
    RULE,
    "",
    "## Task",
    "",
    "1. Fix the failed scans first if any are listed; everything else is downstream of them.",
    "2. Then the releases already admitted by a range — those ship on the next install.",
    "3. Then the policy violations, replacing rather than pinning where the rule is a licence or a deny.",
    "4. Report anything you could not resolve and why. Do not silently skip.",
    "",
  );

  return out.join("\n");
}
