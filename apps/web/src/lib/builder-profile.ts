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
}

/**
 * What /api/scan returns: the whole profile when signed in, or the signed-out
 * cut of it, which keeps the archetype and the first repo's head and counts
 * what it dropped so the ask can be stated in the visitor's own numbers.
 */
export interface BuilderReport extends Omit<BuilderProfile, "traits"> {
  traits: Trait[] | null;
  locked: { repos: number; deps: number; conflicts: number } | null;
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
