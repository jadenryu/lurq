/**
 * Typed access to the landing page's generated artifacts.
 *
 * Nothing on the marketing page is hand-written data. Every number, edge, diff
 * and terminal capture comes out of `scripts/build-landing-content.mts`, which
 * reads the production database and calls the same handlers the MCP server and
 * CLI serve. Re-run it from the repo root to move the page's numbers:
 *
 *   npx tsx scripts/build-landing-content.mts
 *
 * Each file carries `source: 'live'`. `assertLive` refuses a production build if
 * a file was replaced by a development fixture, so placeholder data physically
 * cannot ship — see §22 of the build brief. An artifact that is genuinely absent
 * renders an explicit empty state; it is never filled in with something
 * plausible.
 */
import statsJson from "@/content/generated/stats.json";
import graphJson from "@/content/generated/stack-graph.json";
import usageJson from "@/content/generated/usage-diff.json";
import verifyJson from "@/content/generated/verify-example.json";
import compatJson from "@/content/generated/compat-example.json";
import provenanceJson from "@/content/generated/provenance.json";
import weightsJson from "@/content/generated/weights-example.json";

export type Verdict = "declared" | "conflict" | "verified";

export type StackNode = {
  id: string;
  version: string | null;
  weeklyDownloads: number;
  declaresPeers: number;
  nodeEngine: string | null;
  degree: number;
  conflicts: number;
};

export type StackEdge = {
  source: string;
  target: string;
  verdict: Verdict;
  provenance: "declared" | "verified";
  peer: string;
  range: string;
  optional: boolean;
  detail: string;
  checkedAt: string;
  reproduce: string;
  coOccurrence: { witnesses: number; drivers: string[] } | null;
};

/**
 * One cell of the matrix: a pair, at the strongest level of evidence we hold.
 * `co-occurs` is the weak level — public dependency graphs resolve the two side
 * by side — and it is never described as verified. Pairs with no evidence are
 * absent, which is what leaves the matrix mostly blank.
 */
export type StackPair = {
  a: string;
  b: string;
  level: "conflict" | "declared" | "co-occurs";
  detail: string;
  witnesses: number | null;
  reproduce: string;
};

export type StackGraph = {
  generatedAt: string;
  source: string;
  stackName: string;
  checkedAt: string;
  dataAsOf: string | null;
  nodes: StackNode[];
  edges: StackEdge[];
  pairs: StackPair[];
  counts: {
    nodes: number;
    edges: number;
    declared: number;
    conflict: number;
    verified: number;
    isolated: string[];
    possiblePairs: number;
    coOccurs: number;
    known: number;
  };
};

export type Stats = typeof statsJson;
export type UsageDiff = typeof usageJson;
export type VerifyExample = typeof verifyJson;
export type CompatExample = typeof compatJson;
export type Provenance = typeof provenanceJson;
export type Weights = typeof weightsJson;

/** A production build must never ship development fixture data. */
function assertLive(name: string, source: string): void {
  if (process.env.NODE_ENV === "production" && source !== "live") {
    throw new Error(
      `refusing to build with ${source} data in ${name} — run scripts/build-landing-content.mts`,
    );
  }
}

for (const [name, file] of Object.entries({
  "stats.json": statsJson,
  "stack-graph.json": graphJson,
  "usage-diff.json": usageJson,
  "verify-example.json": verifyJson,
  "compat-example.json": compatJson,
  "provenance.json": provenanceJson,
  "weights-example.json": weightsJson,
})) {
  assertLive(name, (file as { source?: string }).source ?? "unknown");
}

export const stats: Stats = statsJson;
export const stackGraph: StackGraph = graphJson as StackGraph;
export const usageDiff: UsageDiff = usageJson;
export const verifyExample: VerifyExample = verifyJson;
export const compatExample: CompatExample = compatJson;
export const provenance: Provenance = provenanceJson;
export const weights: Weights = weightsJson;

/** `1293237` → `1,293,237`. Grouping only; never rounded into a vaguer claim. */
export function group(n: number | null | undefined): string {
  return typeof n === "number" ? n.toLocaleString("en-US") : "—";
}

/** `2026-08-06T06:16:50Z` → `6 aug 2026`, lowercase to match the headings. */
export function shortDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d
    .toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })
    .toLowerCase();
}

/** `163138787` → `163M`, for graph tooltips where the exact figure is noise. */
export function compactDownloads(n: number): string {
  if (n >= 1_000_000) return `${Math.round(n / 1_000_000)}M`;
  if (n >= 1_000) return `${Math.round(n / 1_000)}k`;
  return String(n);
}
