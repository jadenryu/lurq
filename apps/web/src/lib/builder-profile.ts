/**
 * The builder report's wire types, and the words for each archetype.
 *
 * The types mirror src/github/builderProfile.ts and publicScan.ts on the API,
 * as every cross-hop type in this app does. No "server-only": the report is a
 * client component and renders these directly.
 */

export type ArchetypeId = "shipper" | "architect" | "explorer" | "steward";

export interface ScanDep {
  name: string;
  range: string;
  resolved: string | null;
  latest: string | null;
  majorsBehind: number;
  deprecated: boolean;
  advisories: number;
  /** Absent on scans saved before these existed; see depStatus/depLabel in builder-brief.ts for the fallback. */
  status?: "current" | "behind" | "major" | "unknown";
  /** `range-floor`: the index had no versions, so this is the range's minimum, not what an install picks. */
  resolvedFrom?: "index" | "range-floor";
  /** `resolved`: advisories affecting that exact version. `package`: advisories on the package's latest release. */
  advisoriesAt?: "resolved" | "package";
}

export interface ScanConflict {
  source: "peer-deps" | "engines" | "sandbox" | "resolve";
  packages: string[];
  detail: string;
}

/** One repo's stack, read from its root package.json. */
export interface RepoStack {
  repo: string;
  url: string;
  depsDeclared: number;
  depsTracked: number;
  majorDrift: number;
  anyDrift: number;
  deprecated: number;
  advisories: number;
  /** Every tracked dependency's advisories were checked at its resolved version. */
  advisoriesExact?: boolean;
  conflicts: number;
  deps: ScanDep[];
  conflictDetail: ScanConflict[];
  partial: boolean;
}

export interface Trait {
  id: ArchetypeId;
  score: number | null;
  evidence: string[];
}

export interface BuilderProfile {
  login: string;
  url: string;
  avatarUrl: string;
  archetype: ArchetypeId;
  traits: Trait[];
  stats: {
    repos: number;
    active90: number;
    stars: number;
    languages: { name: string; repos: number }[];
  };
  repos: RepoStack[];
  /** What the GitHub read covered. Absent on profiles saved before it existed. */
  coverage?: {
    reposListed: number;
    /** GitHub had more repos than were read: counts cover the most recently pushed. */
    reposCapped: boolean;
    /** Repos whose package.json could not be read (rate limit, timeout), not repos without one. */
    unreadManifests: string[];
  };
  /** Absent on profiles from before the MCP section. */
  mcp?: ProfileMcp;
}

/**
 * What /api/scan returns: the whole profile when signed in, or the signed-out
 * cut of it, which keeps the archetype and the first repo's head and counts
 * what it dropped so the ask can be stated in the visitor's own numbers.
 */
/** Mirrors src/github/builderMcp.ts; what each status means is there. */
export type McpServerStatus =
  | "probed"
  | "queued"
  | "handshake-failed"
  | "needs-config"
  | "undeclared"
  | "remote-only"
  | "not-probed";

export interface ProfileMcpServer {
  alias: string;
  kind: "npm-stdio" | "remote" | "local" | "other-registry";
  packageName: string | null;
  endpoint: string | null;
  status: McpServerStatus;
  tools: number;
  writes: number;
  destroys: number;
  requiredConfig: string[];
}

export interface ProfileMcp {
  configs: {
    repo: string;
    files: string[];
    servers: ProfileMcpServer[];
    collisions: { tool: string; servers: string[]; writes: boolean }[];
    totalTools: number | null;
    estimatedContextTokens: number | null;
  }[];
  builds: (ProfileMcpServer & { repo: string })[];
  unreadFiles: number;
}

export interface BuilderReport extends Omit<BuilderProfile, "traits"> {
  traits: Trait[] | null;
  /** `mcp`: MCP configs and servers left out of a signed-out report. */
  locked: { repos: number; deps: number; conflicts: number; mcp?: number } | null;
  /** When the account's saved copy was taken. Absent for a visitor; null when saving failed. */
  savedAt?: string | null;
  /** Percentile ranks against other scanned builders. Signed-in reports only; null when unavailable. */
  standing?: BuilderStanding | null;
}

/** Mirrors src/github/builderStanding.ts; the reasoning for each metric is there. */
export type StandingMetricId = "repos" | "active90" | "stars" | "behindShare" | "majorShare" | "advisoryRate";

export interface StandingMetric {
  id: StandingMetricId;
  better: "higher" | "lower";
  /** A count, a 0–1 share, or advisories per 100 dependencies. */
  value: number;
  /** 0–100: the share of compared builders this one is ahead of, ties counting half. */
  percentile: number;
  population: number;
}

export interface BuilderStanding {
  population: number;
  minimum: number;
  /** Only metrics with enough builders to rank against; empty means not enough scans yet. */
  metrics: StandingMetric[];
}

/** One row of the saved list: enough for a card, never the dependency rows. */
export interface SavedBuilderScan {
  target: string;
  login: string;
  archetype: ArchetypeId;
  avatarUrl: string;
  traits: Trait[];
  stats: BuilderProfile["stats"];
  scannedAt: string;
}

/** Dependency rows a signed-out visitor reads on the one repo they get. */
export const FREE_DEPS = 8;

export const ARCHETYPES: Record<ArchetypeId, { name: string; trait: string; line: string }> = {
  shipper: {
    name: "The Shipper",
    trait: "shipping",
    line: "You start things and push them out. Your profile is a trail of recent work, not a shelf of finished projects.",
  },
  architect: {
    name: "The Architect",
    trait: "longevity",
    line: "Fewer projects, built to last. Your best work is years old and still moving.",
  },
  explorer: {
    name: "The Explorer",
    trait: "range",
    line: "You reach for the right tool rather than the familiar one. Breadth is your default.",
  },
  steward: {
    name: "The Steward",
    trait: "stack health",
    line: "What you build stays current. Your dependencies sit where most people's don't: up to date.",
  },
};

/** One advisory, as the `evaluate` tool returns it (its five most severe). */
export interface DepAdvisory {
  id: string;
  severity: string;
  summary: string;
}

/** What `diff_surface` found between the version a repo resolves and the latest. */
export interface DepDiff {
  fromVersion: string;
  toVersion: string;
  verdict: string;
  /** Set when no comparison could be made yet; the lists are then empty and mean nothing. */
  inconclusive?: string;
  removed: { path: string; kind: string }[];
  renamed: { path: string; to: string[] }[];
  arityChanged: { path: string; from: number | null; to: number | null }[];
  typeOnlyRemoved: string[];
  deprecated: string[];
}

/**
 * What /api/scan/dep returns for one opened dependency. A side is null when the
 * row did not need it or it could not be read; `unavailable` then says why.
 */
export interface DepDetail {
  diff: DepDiff | null;
  advisories: DepAdvisory[] | null;
  deprecated: boolean | string | null;
  reasons: string[];
  unavailable: string[];
}
