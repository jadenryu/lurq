// Relative: tests/builderBrief.test.ts imports this from the repo root, where
// `@/` does not resolve. builder-profile has no server or DOM imports.
import {
  ARCHETYPES,
  type ArchetypeId,
  type BuilderReport,
  type RepoStack,
  type ScanDep,
} from "./builder-profile";

/**
 * The builder report, turned into three things a person takes away from it:
 * a summary of what they do well and badly, a brief an agent can act on (for
 * the whole profile or one repo), and the numbers on a shareable stats card.
 *
 * Pure, so the rules below are pinned by tests rather than by eye. The brief
 * follows lib/llm-export's three rules: facts before instructions, never imply
 * an all-clear for what was not read, and no severity this file invented.
 */

function plural(n: number, one: string, many = `${one}s`): string {
  return `${n.toLocaleString("en-US")} ${n === 1 ? one : many}`;
}

// ---------------------------------------------------------------- ranking

/** Evidence order: advisories, then conflicts, then deprecations, then majors behind. */
function severity(s: RepoStack): number[] {
  return [s.advisories, s.conflicts, s.deprecated, s.majorDrift];
}

function flagged(s: RepoStack): boolean {
  return severity(s).some((n) => n > 0);
}

/** Repos, most in need of work first. Stable, so ties keep the report's order. */
export function rankRepos(repos: RepoStack[]): RepoStack[] {
  return [...repos].sort((a, b) => {
    const [x, y] = [severity(a), severity(b)];
    for (let i = 0; i < x.length; i++) if (x[i] !== y[i]) return y[i] - x[i];
    return 0;
  });
}

/** "2 advisories, 1 conflict, 3 majors behind", or null when nothing is flagged. */
export function issueLine(s: RepoStack): string | null {
  const parts = [
    s.advisories > 0 && plural(s.advisories, "advisory", "advisories"),
    s.conflicts > 0 && plural(s.conflicts, "conflict"),
    s.deprecated > 0 && `${s.deprecated} deprecated`,
    s.majorDrift > 0 && `${plural(s.majorDrift, "major")} behind`,
  ].filter(Boolean);
  return parts.length ? parts.join(", ") : null;
}

// ---------------------------------------------------------------- summary

export interface SummaryPoint {
  title: string;
  detail: string;
}

const STRONG: Record<ArchetypeId, string> = {
  shipper: "You ship often",
  architect: "Your projects last",
  explorer: "You work across stacks",
  steward: "Your dependencies stay current",
};

const WEAK: Record<ArchetypeId, string> = {
  shipper: "Little recent activity",
  architect: "Few long-lived projects",
  explorer: "A narrow toolset",
  steward: "Dependencies have fallen behind",
};

/** Trait thresholds. ponytail: hand-set, like the trait constants they sit on. */
const STRONG_AT = 60;
const WEAK_BELOW = 35;

/**
 * What they do well and what to fix. `null` when traits are locked: the
 * summary is the scores in words, so it cannot be shown without them.
 */
export function summarize(report: BuilderReport): { strengths: SummaryPoint[]; gaps: SummaryPoint[] } | null {
  if (!report.traits) return null;
  const scored = report.traits
    .filter((t) => t.score !== null)
    .sort((a, b) => b.score! - a.score!);

  const strengths: SummaryPoint[] = scored
    .filter((t) => t.score! >= STRONG_AT)
    .map((t) => ({ title: STRONG[t.id], detail: t.evidence.join(", ") }));
  // Everyone gets at least one: the strongest trait is a strength relative to
  // the rest, even when it is not high.
  if (strengths.length === 0 && scored[0]) {
    const t = scored[0];
    strengths.push({ title: `Strongest at ${ARCHETYPES[t.id].trait}`, detail: t.evidence.join(", ") });
  }

  const gaps: SummaryPoint[] = scored
    .filter((t) => t.score! < WEAK_BELOW)
    .map((t) => ({ title: WEAK[t.id], detail: t.evidence.join(", ") }));

  const repos = report.repos;
  const read = repos.filter((s) => s.depsTracked > 0);
  const sum = (k: "advisories" | "conflicts" | "majorDrift" | "deprecated") =>
    repos.reduce((n, s) => n + s[k], 0);
  const worst = rankRepos(repos).find(flagged);

  if (sum("advisories") > 0) {
    gaps.push({
      title: `${plural(sum("advisories"), "known advisory", "known advisories")}`,
      detail: `across ${plural(repos.filter((s) => s.advisories > 0).length, "repo")}${worst ? `, start with ${worst.repo}` : ""}`,
    });
  }
  if (sum("conflicts") > 0) {
    gaps.push({
      title: `${plural(sum("conflicts"), "upgrade conflict")}`,
      detail: "packages that would break each other at their latest versions",
    });
  }
  if (sum("majorDrift") + sum("deprecated") > 0 && sum("advisories") === 0) {
    gaps.push({
      title: `${plural(sum("majorDrift"), "dependency", "dependencies")} a major behind`,
      detail: `${sum("deprecated")} deprecated${worst ? `, most in ${worst.repo}` : ""}`,
    });
  }
  // Scoped to what was read, never "your code is safe".
  if (read.length > 0 && sum("advisories") === 0 && sum("conflicts") === 0) {
    const deps = read.reduce((n, s) => n + s.depsTracked, 0);
    strengths.push({
      title: "No known advisories or conflicts",
      detail: `in the ${plural(deps, "indexed dependency", "indexed dependencies")} across ${plural(read.length, "repo")} read`,
    });
  }

  return { strengths, gaps };
}

// ---------------------------------------------------------------- briefs

function depIssue(d: ScanDep): string | null {
  if (d.advisories > 0) return plural(d.advisories, "advisory", "advisories");
  if (d.deprecated) return "deprecated";
  if (d.majorsBehind > 0) return `${plural(d.majorsBehind, "major")} behind`;
  return null;
}

function cell(s: string): string {
  return s.replace(/\|/g, "\\|");
}

/** One repo's facts, at heading level `h`. `hiddenDeps` were cut from a signed-out report. */
function repoSection(s: RepoStack, h: string, hiddenDeps = 0): string[] {
  const out = [`${h} ${s.repo}`, "", `${s.url} · root package.json only`];
  const untracked = s.depsDeclared - s.depsTracked;
  out.push(
    `${plural(s.depsTracked, "dependency", "dependencies")} checked against the lurq index` +
      (untracked > 0 ? `; ${untracked} not indexed yet, so unchecked (not clean)` : "") +
      ".",
  );
  if (s.partial) out.push("The scan was partial: treat anything not listed as unchecked.");
  if (hiddenDeps > 0) out.push(`${plural(hiddenDeps, "more dependency", "more dependencies")} not included in this export.`);
  out.push("");

  if (s.depsTracked === 0) {
    out.push("Nothing in this manifest is indexed yet. No findings, and no all-clear.", "");
    return out;
  }

  const bad = s.deps.filter((d) => depIssue(d));
  if (bad.length) {
    out.push("| package | declared | resolved | latest | issue |", "| --- | --- | --- | --- | --- |");
    for (const d of bad) {
      out.push(
        `| ${cell(d.name)} | ${cell(d.range)} | ${d.resolved ?? "?"} | ${d.latest ?? "?"} | ${depIssue(d)} |`,
      );
    }
    out.push("");
  } else {
    out.push("No advisories, deprecations or majors behind among the dependencies listed.", "");
  }

  if (s.conflictDetail.length) {
    out.push("Conflicts if upgraded to latest:");
    for (const c of s.conflictDetail) out.push(`- [${c.source}] ${c.packages.join(" + ")}: ${c.detail}`);
    out.push("");
  } else if (s.conflicts > 0) {
    out.push(`${plural(s.conflicts, "conflict")} at latest (detail not included in this export).`, "");
  }
  return out;
}

const INSTRUCTIONS = [
  "## What to do",
  "",
  "1. Work repo by repo in the order above. Open each repo's package.json before changing anything.",
  "2. Advisories first: upgrade to a version that is not affected. If the latest shown is still affected, say so rather than guessing a version.",
  "3. Then conflicts: resolve the packages named together, in one change, and explain the trade-off.",
  "4. Then deprecated packages, then majors behind. One major upgrade per commit, and read its changelog for breaking changes first.",
  "5. After each change, install, typecheck and run the tests. Stop and report if anything fails instead of widening the change.",
  "6. Anything marked unchecked or not indexed has not been looked at. Do not report it as fine.",
];

/** A brief for one repo, standalone. */
export function repoBrief(s: RepoStack, hiddenDeps = 0): string {
  return [
    `# Dependency brief: ${s.repo}`,
    "",
    `Findings from lurq (lurq.run). ${issueLine(s) ?? "Nothing flagged among the dependencies checked."}`,
    "",
    ...repoSection(s, "##", hiddenDeps),
    ...INSTRUCTIONS,
  ].join("\n");
}

/** The whole report as one brief: who, the summary, then every repo worst-first. */
export function reportBrief(report: BuilderReport): string {
  const type = ARCHETYPES[report.archetype];
  const summary = summarize(report);
  const ranked = rankRepos(report.repos);
  const out = [
    `# Builder report: @${report.login}`,
    "",
    `From lurq (lurq.run), read from ${report.url}'s public repos and the lurq dependency index.`,
    `Builder type: ${type.name}. ${type.line}`,
    `${plural(report.stats.repos, "repo")} owned, ${report.stats.active90} active in the last 90 days, ${plural(report.stats.stars, "star")}.`,
    "",
    "## Coverage",
    "",
    `- ${plural(report.repos.length, "repo")} had a root package.json that was read. Other repos and nested manifests were not.`,
  ];
  if (report.locked && report.locked.repos > 0) {
    out.push(`- ${plural(report.locked.repos, "more repo")} read but not in this export. Sign in at lurq.run for the full report.`);
  }
  out.push("");

  if (summary) {
    out.push("## Summary", "");
    for (const p of summary.strengths) out.push(`- Strength: ${p.title} (${p.detail})`);
    for (const p of summary.gaps) out.push(`- To fix: ${p.title} (${p.detail})`);
    out.push("");
  }

  if (ranked.length === 0) {
    out.push("No JavaScript stack was found to read, so there are no dependency findings.");
    return out.join("\n");
  }

  out.push("## Projects, most in need of work first", "");
  ranked.forEach((s, i) => {
    out.push(`- ${i + 1}. ${s.repo}: ${issueLine(s) ?? (s.depsTracked ? "nothing flagged" : "not indexed yet")}`);
  });
  out.push("");
  for (const s of ranked) {
    const hidden = report.locked && s === report.repos[0] ? report.locked.deps : 0;
    out.push(...repoSection(s, "##", hidden));
  }
  out.push(...INSTRUCTIONS);
  return out.join("\n");
}

// ---------------------------------------------------------------- card

export type CardTier = "gold" | "silver" | "bronze";

export interface CardStats {
  overall: number;
  /** Three letters, like a position. */
  position: string;
  tier: CardTier;
  stats: { label: string; value: string }[];
}

const POSITION: Record<ArchetypeId, string> = {
  shipper: "SHP",
  architect: "ARC",
  explorer: "EXP",
  steward: "STW",
};

function compact(n: number): string {
  return n >= 1000 ? `${(n / 1000).toFixed(n >= 10_000 ? 0 : 1)}k` : String(n);
}

/**
 * The card's numbers, from a signed-in report (traits required).
 *
 * Overall is position-weighted, the way a player's is: the archetype trait
 * counts 60%, the mean of the other scored traits 40%. A plain mean would put
 * every specialist in the 40s, which is accurate about nothing.
 * FIFA's own tier cut-offs: 75 gold, 65 silver.
 */
export function cardStats(report: BuilderReport): CardStats | null {
  if (!report.traits) return null;
  const score = (id: ArchetypeId) => report.traits!.find((t) => t.id === id)?.score ?? null;
  const main = score(report.archetype) ?? 0;
  const others = report.traits
    .filter((t) => t.id !== report.archetype && t.score !== null)
    .map((t) => t.score!);
  const overall = others.length
    ? Math.round(0.6 * main + 0.4 * (others.reduce((a, b) => a + b, 0) / others.length))
    : main;
  const show = (id: ArchetypeId) => {
    const s = score(id);
    return s === null ? "--" : String(s);
  };

  return {
    overall,
    position: POSITION[report.archetype],
    tier: overall >= 75 ? "gold" : overall >= 65 ? "silver" : "bronze",
    stats: [
      { label: "SHP", value: show("shipper") },
      { label: "LON", value: show("architect") },
      { label: "RNG", value: show("explorer") },
      { label: "HLT", value: show("steward") },
      { label: "STR", value: compact(report.stats.stars) },
      { label: "ACT", value: String(report.stats.active90) },
    ],
  };
}
