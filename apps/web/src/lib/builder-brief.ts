// Relative: tests/builderBrief.test.ts imports this from the repo root, where
// `@/` does not resolve. builder-profile has no server or DOM imports.
import {
  ARCHETYPES,
  type ArchetypeId,
  type BuilderReport,
  type DepDetail,
  type RepoStack,
  type ScanConflict,
  type ScanDep,
} from "./builder-profile";
import { siteUrl } from "./site";

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
    for (let i = 0; i < x.length; i++) if (x[i] !== y[i]) return (y[i] ?? 0) - (x[i] ?? 0);
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
  // Shown alongside advisories, not instead of them, and titled by what is
  // actually there: a report with only deprecated packages used to read
  // "0 dependencies a major behind".
  if (sum("majorDrift") + sum("deprecated") > 0) {
    gaps.push(
      sum("majorDrift") > 0
        ? {
            title: `${plural(sum("majorDrift"), "dependency", "dependencies")} a major behind`,
            detail: `${sum("deprecated")} deprecated${worst ? `, most in ${worst.repo}` : ""}`,
          }
        : {
            title: `${plural(sum("deprecated"), "deprecated dependency", "deprecated dependencies")}`,
            detail: `none a major behind${worst ? `, most in ${worst.repo}` : ""}`,
          },
    );
  }
  // Scoped to what was read, never "your code is safe", and only when every repo's
  // advisories were checked at the versions it resolves to. A count taken from
  // the latest release is not evidence about the version in use.
  if (
    read.length > 0 &&
    read.every((r) => r.advisoriesExact === true) &&
    sum("advisories") === 0 &&
    sum("conflicts") === 0
  ) {
    const deps = read.reduce((n, s) => n + s.depsTracked, 0);
    strengths.push({
      title: "No known advisories or conflicts",
      detail: `in the ${plural(deps, "indexed dependency", "indexed dependencies")} across ${plural(read.length, "repo")} read`,
    });
  }

  return { strengths, gaps };
}

// ---------------------------------------------------------------- briefs

/**
 * Where a dependency stands. The API sends it; a scan saved before that did not,
 * so it is worked out from what that scan did carry. The fallback never says
 * current unless the two versions are the same string.
 */
export function depStatus(d: ScanDep): NonNullable<ScanDep["status"]> {
  if (d.status) return d.status;
  if (d.majorsBehind > 0) return "major";
  if (!d.resolved || !d.latest) return "unknown";
  return d.resolved === d.latest ? "current" : "behind";
}

/**
 * The words for a dependency's state, worst first. Advisories say which version
 * they are about: counted at the resolved version, or (older scans, or when the
 * exact check could not run) only known for the latest release.
 */
export function depLabel(d: ScanDep): string {
  if (d.advisories > 0) {
    const where = d.advisoriesAt === "resolved" && d.resolved ? ` at ${d.resolved}` : " on the latest release";
    return `${plural(d.advisories, "advisory", "advisories")}${where}`;
  }
  if (d.deprecated) return "deprecated";
  switch (depStatus(d)) {
    case "major":
      return d.majorsBehind > 0 ? `${plural(d.majorsBehind, "major")} behind` : "breaking 0.x release behind";
    case "behind":
      return "behind latest";
    case "unknown":
      return "version unknown";
    default:
      return "current";
  }
}

/** An issue worth flagging: an advisory, a deprecation, or a breaking release behind. */
function depIssue(d: ScanDep): string | null {
  return d.advisories > 0 || d.deprecated || depStatus(d) === "major" ? depLabel(d) : null;
}

/** Below this top-trait score the archetype is the closest fit, not a description, and its line would overclaim. */
export const ARCHETYPE_FLOOR = 30;

export function archetypeLine(report: Pick<BuilderReport, "archetype" | "traits">): string {
  const top = report.traits?.find((t) => t.id === report.archetype)?.score ?? null;
  if (report.traits && (top === null || top < ARCHETYPE_FLOOR)) {
    return "There is not much public activity to read yet, so this is the closest fit rather than a description.";
  }
  return ARCHETYPES[report.archetype].line;
}

/** Whole days since a saved report was taken; 0 for less than a day. */
export function savedDaysAgo(savedAt: string, now = Date.now()): number {
  return Math.max(0, Math.floor((now - Date.parse(savedAt)) / 86_400_000));
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

/**
 * What the agent does with the facts, then how it checks its own work with lurq.
 *
 * The lurq half is the point of the export as much as the list is: a model
 * fixing a major upgrade from memory writes against an API from before its
 * cutoff, which is the exact failure the findings came from. If lurq is not
 * connected, the agent tells the user how to get it rather than installing
 * anything itself. `target` is what a rescan should read (a login or owner/repo).
 */
function instructions(target: string): string[] {
  return [
    "## What to do",
    "",
    "1. Work repo by repo in the order above. Open each repo's package.json before changing anything.",
    "2. Advisories first: upgrade to a version that is not affected. If the latest shown is still affected, say so rather than guessing a version.",
    "3. Then conflicts: resolve the packages named together, in one change, and explain the trade-off.",
    "4. Then deprecated packages, then majors behind. One major upgrade per commit, and read its changelog for breaking changes first.",
    "5. After each change, install, typecheck and run the tests. Stop and report if anything fails instead of widening the change.",
    "6. Anything marked unchecked or not indexed has not been looked at. Do not report it as fine.",
    "",
    "## Check each change with lurq",
    "",
    "Most of these releases are newer than your training data. If the lurq MCP tools are available to you, use them instead of recalling APIs:",
    "",
    "- `diff_surface` (package, fromVersion, toVersion) before a major upgrade: the exports removed or renamed. Search this repo for each one.",
    "- `compat` on every package you are about to change, as one set, before installing: it resolves them the way npm does and names any clashing constraints.",
    "- `usage` (package, version, knownVersion) when writing code against the new version: its typed API, and what changed since the version you know.",
    "- `verify` before adding or swapping in any package not named above.",
    "",
    "If those tools are not available, do not install anything yourself. When you finish, tell the user that `npx lurqrun` adds lurq to their coding agent, so the next upgrade is checked before it is written.",
    "",
    `When the fixes are on the default branch, tell the user to scan again to confirm the counts dropped: ${siteUrl(`/dashboard/report?target=${encodeURIComponent(target)}`)}`,
  ];
}

/** A brief for one repo, standalone. */
export function repoBrief(s: RepoStack, hiddenDeps = 0): string {
  return [
    `# Dependency brief: ${s.repo}`,
    "",
    `Findings from lurq (lurq.run). ${issueLine(s) ?? "Nothing flagged among the dependencies checked."}`,
    "",
    ...repoSection(s, "##", hiddenDeps),
    ...instructions(s.repo),
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
  out.push(...instructions(report.login));
  return out.join("\n");
}

// ---------------------------------------------------------------- card

export type CardTier = "gold" | "silver" | "bronze";

export interface CardStats {
  overall: number;
  /** The archetype's code, the same one that labels its trait row on the card. */
  position: string;
  tier: CardTier;
}

/** One code per trait. A trait IS an archetype's score, so it gets one name, not two. */
export const TRAIT_CODE: Record<ArchetypeId, string> = {
  shipper: "SHP",
  architect: "ARC",
  explorer: "EXP",
  steward: "STW",
};

const TRAIT_ORDER: ArchetypeId[] = ["shipper", "architect", "explorer", "steward"];

function compact(n: number): string {
  return n >= 1000 ? `${(n / 1000).toFixed(n >= 10_000 ? 0 : 1)}k` : String(n);
}

/**
 * The card's rating, from a signed-in report (traits required).
 *
 * Overall is position-weighted, the way a player's is: the archetype trait
 * counts 60%, the mean of the other scored traits 40%. A plain mean would put
 * every specialist in the 40s, which is accurate about nothing. The archetype
 * is the top trait, so overall never exceeds it. A trait with nothing to
 * measure (stack health with no indexed dependencies) is left out of the mean,
 * not counted as a zero. FIFA's own tier cut-offs: 75 gold, 65 silver.
 */
export function cardStats(report: BuilderReport): CardStats | null {
  if (!report.traits) return null;
  const main = report.traits.find((t) => t.id === report.archetype)?.score ?? 0;
  const others = report.traits
    .filter((t) => t.id !== report.archetype && t.score !== null)
    .map((t) => t.score!);
  const overall = others.length
    ? Math.round(0.6 * main + 0.4 * (others.reduce((a, b) => a + b, 0) / others.length))
    : main;
  return {
    overall,
    position: TRAIT_CODE[report.archetype],
    tier: overall >= 75 ? "gold" : overall >= 65 ? "silver" : "bronze",
  };
}

export interface CardProfile {
  /** Stable per login. An identifier, not a measurement. */
  id: string;
  traits: { id: ArchetypeId; code: string; name: string; score: number | null }[];
  /** Top four, each as a share of the owned repos (so they need not sum to 1). */
  languages: { name: string; share: number }[];
  github: { label: string; value: string }[];
  /** Stacks read, and the counts the stack health score is computed from. */
  stacks: number;
  stack: { label: string; value: string; alert: boolean }[];
  /**
   * Tracked dependencies split three ways, from exact per-repo counts. `null`
   * when nothing was tracked, which is "unmeasured", not "all current".
   */
  freshness: { current: number; behind: number; major: number } | null;
  /** Packages declared in the most repos. */
  packages: string[];
}

/**
 * Everything else the card prints, from a signed-in report (traits required).
 *
 * WHY COUNTS AND NOT THE DEP ROWS. Each repo's `deps` is capped and sorted worst
 * first, so a split computed from the rows overstates the problems on any stack
 * past the cap. The per-repo counts are exact. `anyDrift` includes `majorDrift`
 * (a major behind is behind), which is what makes the three-way split disjoint.
 *
 * Stack counts are summed over repos, the same way the stack health trait sums
 * them: a package used in two repos is two dependencies to keep current.
 *
 * ponytail: `packages` ranks from the capped rows, so on a stack past the cap a
 * widely used, perfectly current package can be missed. Rank from the manifest
 * names if the card ever needs to be exact about it.
 */
export function cardProfile(report: BuilderReport): CardProfile | null {
  if (!report.traits) return null;
  const traits = report.traits;
  const sum = (pick: (s: BuilderReport["repos"][number]) => number) =>
    report.repos.reduce((n, s) => n + pick(s), 0);
  const tracked = sum((s) => s.depsTracked);
  const drifted = sum((s) => s.anyDrift);
  const major = sum((s) => s.majorDrift);
  const deprecated = sum((s) => s.deprecated);
  const advisories = sum((s) => s.advisories);
  const conflicts = sum((s) => s.conflicts);
  const { repos, active90, stars, languages } = report.stats;

  const uses = new Map<string, number>();
  for (const s of report.repos) for (const d of s.deps) uses.set(d.name, (uses.get(d.name) ?? 0) + 1);

  // FNV-1a: short, stable, and the same for any casing of the login.
  let h = 0x811c9dc5;
  for (const ch of report.login.toLowerCase()) h = Math.imul(h ^ ch.charCodeAt(0), 0x01000193);

  return {
    id: (h >>> 0).toString(16).padStart(8, "0").toUpperCase(),
    traits: TRAIT_ORDER.map((id) => ({
      id,
      code: TRAIT_CODE[id],
      name: ARCHETYPES[id].trait,
      score: traits.find((t) => t.id === id)?.score ?? null,
    })),
    languages: repos ? languages.slice(0, 4).map((l) => ({ name: l.name, share: l.repos / repos })) : [],
    github: [
      { label: "repos", value: compact(repos) },
      { label: "active 90d", value: String(active90) },
      { label: "stars", value: compact(stars) },
    ],
    stacks: report.repos.length,
    stack: [
      { label: "deps tracked", value: compact(tracked), alert: false },
      { label: "a major behind", value: String(major), alert: major > 0 },
      { label: "deprecated", value: String(deprecated), alert: deprecated > 0 },
      { label: "advisories", value: String(advisories), alert: advisories > 0 },
      { label: "conflicts at latest", value: String(conflicts), alert: conflicts > 0 },
    ],
    freshness: tracked
      ? {
          // Clamped: counts from different queries can disagree by a row, and a
          // negative segment would draw nothing and skew the rest.
          current: Math.max(0, tracked - Math.max(drifted, major)),
          behind: Math.max(0, drifted - major),
          major: Math.min(major, tracked),
        }
      : null,
    packages: [...uses]
      .sort((x, y) => y[1] - x[1] || x[0].localeCompare(y[0]))
      .slice(0, 6)
      .map(([name]) => name),
  };
}

// ---------------------------------------------------------------- drill-down

/** A conflict lists packages as `name` or `name@version`; does this entry mean `name`? */
export function namesPackage(entry: string, name: string): boolean {
  return entry === name || entry.startsWith(`${name}@`);
}

export interface PackageUse {
  repo: string;
  dep: ScanDep;
}

export interface PackageImpact {
  uses: PackageUse[];
  conflicts: { repo: string; conflict: ScanConflict }[];
}

/** Every repo read that declares `name`, and every conflict that names it. */
export function packageImpact(report: BuilderReport, name: string): PackageImpact {
  const impact: PackageImpact = { uses: [], conflicts: [] };
  for (const s of report.repos) {
    const dep = s.deps.find((d) => d.name === name);
    if (dep) impact.uses.push({ repo: s.repo, dep });
    for (const c of s.conflictDetail) {
      if (c.packages.some((p) => namesPackage(p, name))) impact.conflicts.push({ repo: s.repo, conflict: c });
    }
  }
  return impact;
}

export interface SharedPackage {
  name: string;
  uses: PackageUse[];
  /** Distinct resolved versions (or declared ranges, where nothing resolved) across those repos. */
  versions: string[];
  flagged: boolean;
}

/** Packages declared in more than one repo: flagged first, then the widest version spread. */
export function sharedPackages(report: BuilderReport): SharedPackage[] {
  const byName = new Map<string, PackageUse[]>();
  for (const s of report.repos) {
    for (const dep of s.deps) byName.set(dep.name, [...(byName.get(dep.name) ?? []), { repo: s.repo, dep }]);
  }
  return [...byName]
    .filter(([, uses]) => uses.length > 1)
    .map(([name, uses]) => ({
      name,
      uses,
      versions: [...new Set(uses.map((u) => u.dep.resolved ?? u.dep.range))],
      flagged: uses.some((u) => depIssue(u.dep) !== null),
    }))
    .sort(
      (a, b) =>
        Number(b.flagged) - Number(a.flagged) ||
        b.versions.length - a.versions.length ||
        b.uses.length - a.uses.length ||
        a.name.localeCompare(b.name),
    );
}

/**
 * A fix prompt for one package across every repo that declares it, with whatever
 * lurq looked up about it when the row was opened (`detail`). Without a diff it
 * says the comparison is missing rather than implying nothing changed.
 */
export function depBrief(report: BuilderReport, name: string, detail?: DepDetail | null): string {
  const { uses, conflicts } = packageImpact(report, name);
  const out = [
    `# Upgrade brief: ${name}`,
    "",
    `Findings from lurq (lurq.run) for @${report.login}'s repos, root package.json files only.`,
    "",
    "## Where it is declared",
    "",
    "| repo | declared | resolved | latest | issue |",
    "| --- | --- | --- | --- | --- |",
    ...uses.map(
      (u) =>
        `| ${u.repo} | ${cell(u.dep.range)} | ${u.dep.resolved ?? "?"} | ${u.dep.latest ?? "?"} | ${depLabel(u.dep)} |`,
    ),
    "",
  ];

  if (conflicts.length) {
    out.push("## Conflicts that name it, at latest versions", "");
    for (const { repo, conflict: c } of conflicts) out.push(`- ${repo} [${c.source}] ${c.packages.join(" + ")}: ${c.detail}`);
    out.push("");
  }

  if (detail?.deprecated) {
    out.push(`Deprecated: ${typeof detail.deprecated === "string" ? detail.deprecated : "yes, by its maintainers"}.`, "");
  }
  const advisories = detail?.advisories ?? [];
  if (advisories.length) {
    out.push("## Advisories on record", "");
    for (const a of advisories) out.push(`- ${a.id} (${a.severity}): ${a.summary}`);
    out.push("", "Check which versions each advisory affects before choosing the version to move to.", "");
  }

  const d = detail?.diff;
  if (d) {
    out.push(`## What changed, ${d.fromVersion} → ${d.toVersion}`, "");
    if (d.inconclusive) {
      out.push(`Not compared yet: ${d.inconclusive}`, "", "Run `diff_surface` yourself before upgrading.", "");
    } else {
      const renamed = new Map(d.renamed.map((r) => [r.path, r.to]));
      const code = (p: string) => `\`${p}\``;
      if (d.removed.length) {
        out.push("Removed at runtime (breaks `node`):");
        for (const s of d.removed) {
          const to = renamed.get(s.path);
          out.push(`- ${code(s.path)}${to ? ` → now ${to.map(code).join(" or ")}` : ""}`);
        }
        out.push("");
      }
      if (d.arityChanged.length) {
        out.push("Parameter count changed:");
        for (const a of d.arityChanged) out.push(`- ${code(a.path)}: ${a.from ?? "?"} → ${a.to ?? "?"}`);
        out.push("");
      }
      if (d.typeOnlyRemoved.length) out.push(`Type-only removals (break \`tsc\`, not \`node\`): ${d.typeOnlyRemoved.map(code).join(", ")}`, "");
      if (d.deprecated.length) out.push(`Newly deprecated: ${d.deprecated.map(code).join(", ")}`, "");
      if (!d.removed.length && !d.arityChanged.length && !d.typeOnlyRemoved.length) {
        out.push("No runtime exports were removed or re-shaped. Behaviour and configuration changes are not covered: read the changelog.", "");
      } else {
        out.push("These are the package's changes. Search each repo above for every name listed before upgrading.", "");
      }
    }
  } else if (uses.some((u) => u.dep.majorsBehind > 0)) {
    out.push("What changed between versions is not included here. Run `diff_surface` before upgrading.", "");
  }

  out.push(...instructions(report.login));
  return out.join("\n");
}

/** A fix prompt for one conflict: the packages with this repo's versions of each. */
export function conflictBrief(report: BuilderReport, repo: string, c: ScanConflict): string {
  const stack = report.repos.find((s) => s.repo === repo);
  const out = [
    `# Conflict brief: ${c.packages.join(" + ")}`,
    "",
    `Found by lurq (lurq.run) in ${repo}'s root package.json, checking the stack at its latest versions.`,
    "",
    `- [${c.source}] ${c.detail}`,
    "",
    "| package | declared | resolved | latest |",
    "| --- | --- | --- | --- |",
  ];
  for (const p of c.packages) {
    const dep = stack?.deps.find((d) => namesPackage(p, d.name));
    out.push(
      dep
        ? `| ${dep.name} | ${cell(dep.range)} | ${dep.resolved ?? "?"} | ${dep.latest ?? "?"} |`
        : `| ${cell(p)} | not declared at the root | ? | ? |`,
    );
  }
  out.push(
    "",
    "Resolve these together, in one change: choose versions whose peer and engine ranges accept each other, and explain the trade-off. Run `compat` on the final set before installing.",
    "",
    ...instructions(repo),
  );
  return out.join("\n");
}
