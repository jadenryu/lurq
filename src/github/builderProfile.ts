/**
 * "What kind of builder are you?", read from a public GitHub profile and the
 * stacks inside it.
 *
 * Paxel answers this from coding-agent transcripts. lurq has two different
 * sources and uses only those: the public repo listing (what someone builds,
 * how often, in how many languages) and its own dependency index (whether what
 * they built is kept current). Four traits, each scored from facts the report
 * can print next to the number, and the archetype is the strongest of them.
 *
 * THE WHOLE PROFILE IS COMPUTED FOR EVERYONE. What a signed-out visitor sees is
 * cut down at the web hop (apps/web/src/app/api/scan). Computing a smaller
 * profile for them instead would let the archetype change on sign-up — scored
 * from one repo, then from six — which reads as the product making it up. This
 * way signing up reveals the evidence for an answer they already had.
 *
 * Cost per uncached profile: one REST call (the repo listing), up to
 * MANIFEST_TRIES raw.githubusercontent reads, and STACK_REPOS drift queries.
 */
import type { Database } from '../db/client';
import {
  GitHubUnavailableError,
  readGitHub,
  rootManifestRead,
  scanManifest,
  type PublicScan,
} from './publicScan';

export type ArchetypeId = 'shipper' | 'architect' | 'explorer' | 'steward';

export interface Trait {
  id: ArchetypeId;
  /** 0–100. `null` when there was nothing to measure, never a disguised zero. */
  score: number | null;
  /** The facts the score came from, in words a report can print. */
  evidence: string[];
}

export interface BuilderProfile {
  /** GitHub's spelling of the login, not whatever case was typed. */
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
  /** Stack scans, the typed repo first when one was typed and it had a manifest. */
  repos: PublicScan[];
  /** What the read covered, so a report never states more than it saw. */
  coverage: ProfileCoverage;
}

export interface ProfileCoverage {
  /** Repos GitHub listed, forks included, up to REPO_PAGES pages. */
  reposListed: number;
  /** GitHub had more repos than were read (or a later page failed): counts cover the most recently pushed. */
  reposCapped: boolean;
  /** Repos whose package.json could not be read (rate limit, timeout). Not the same as having none. */
  unreadManifests: string[];
}

/** The fields of GitHub's repo listing this reads. */
export interface GhRepo {
  name: string;
  owner: { login: string };
  fork: boolean;
  archived: boolean;
  language: string | null;
  stargazers_count: number;
  created_at: string;
  pushed_at: string | null;
}

const DAY = 86_400_000;

/** Repos whose root manifest is tried, and how many of the hits get a stack scan. */
const MANIFEST_TRIES = 10;
const STACK_REPOS = 6;

/** Languages whose repos are likely to have a package.json, tried first. */
const JS = new Set(['JavaScript', 'TypeScript', 'Vue', 'Svelte', 'Astro', 'MDX']);

/** 0 → 0, k → 63, 2k → 86, 3k → 95. The fortieth repo says less than the fourth. */
function saturate(x: number, k: number): number {
  return Math.round(100 * (1 - Math.exp(-Math.max(0, x) / k)));
}

function plural(n: number, one: string, many = `${one}s`): string {
  return `${n.toLocaleString('en-US')} ${n === 1 ? one : many}`;
}

function activeRepos(repos: GhRepo[], now: number): number {
  return repos.filter(
    (r) => !r.fork && !r.archived && r.pushed_at && now - Date.parse(r.pushed_at) < 90 * DAY,
  ).length;
}

/**
 * The four trait scores. Pure, so its test needs neither GitHub nor a database.
 *
 * ponytail: hand-set constants (the `k`s), not a model fit to anything. They put
 * an active hobbyist mid-scale on the traits they actually have. Refit them once
 * there are enough scanned profiles to see the real distribution.
 */
export function scoreTraits(repos: GhRepo[], stacks: PublicScan[], now = Date.now()): Trait[] {
  const owned = repos.filter((r) => !r.fork);

  const active90 = activeRepos(repos, now);
  const started = owned.filter((r) => now - Date.parse(r.created_at) < 365 * DAY).length;

  // Two years between first commit and last push, AND pushed this year. Age on
  // its own is a graveyard, not architecture.
  const sustained = owned.filter(
    (r) =>
      !r.archived &&
      r.pushed_at &&
      Date.parse(r.pushed_at) - Date.parse(r.created_at) > 730 * DAY &&
      now - Date.parse(r.pushed_at) < 365 * DAY,
  ).length;
  const top = owned.reduce<GhRepo | null>(
    (best, r) => (r.stargazers_count > (best?.stargazers_count ?? 0) ? r : best),
    null,
  );

  const languages = new Set(owned.map((r) => r.language).filter(Boolean)).size;

  const tracked = stacks.reduce((s, x) => s + x.depsTracked, 0);
  const behind = stacks.reduce((s, x) => s + x.majorDrift + x.deprecated, 0);
  const advisories = stacks.reduce((s, x) => s + x.advisories, 0);
  const conflicts = stacks.reduce((s, x) => s + x.conflicts, 0);
  const majors = stacks.reduce((s, x) => s + x.majorDrift, 0);
  const deprecatedDeps = stacks.reduce((s, x) => s + x.deprecated, 0);
  // Health is a share, which on its own would crown a five-dependency toy.
  // Scaling it by how much there was to keep current means stewardship is
  // earned on a real stack.
  const health =
    tracked === 0 ? 0 : Math.max(0, 1 - (behind + 2 * advisories) / tracked - 0.05 * conflicts);

  return [
    {
      id: 'shipper',
      score: saturate(active90 + started / 2, 4),
      evidence: [
        `${plural(active90, 'repo')} pushed to in the last 90 days (any branch)`,
        `${plural(started, 'repo')} started in the last year`,
      ],
    },
    {
      id: 'architect',
      score: saturate(sustained + Math.log10(1 + (top?.stargazers_count ?? 0)), 3),
      evidence: [
        `${plural(sustained, 'repo')} kept alive for 2+ years`,
        top ? `${plural(top.stargazers_count, 'star')} on ${top.name}` : 'no starred repos yet',
      ],
    },
    {
      id: 'explorer',
      score: saturate(languages - 1 + owned.length / 10, 4),
      evidence: [`${plural(languages, 'language')} across ${plural(owned.length, 'repo')}`],
    },
    {
      id: 'steward',
      score: tracked === 0 ? null : Math.round(health * saturate(tracked, 20)),
      evidence:
        tracked === 0
          ? ['no indexed JavaScript dependencies to measure']
          : [
              `${plural(tracked, 'dependency', 'dependencies')} read across ${plural(stacks.length, 'repo')}`,
              // Separate counts: a dependency both a major behind and deprecated is one of each, not two of one.
              `${majors} a major behind, ${deprecatedDeps} deprecated, ${plural(advisories, 'advisory', 'advisories')}, ${plural(conflicts, 'conflict')} at latest`,
            ],
    },
  ];
}

/** The strongest trait. A `null` score never wins; ties go to the earlier trait. */
export function pickArchetype(traits: Trait[]): ArchetypeId {
  return traits.reduce((best, t) => ((t.score ?? -1) > (best.score ?? -1) ? t : best)).id;
}

/**
 * Profile one GitHub login. `featured` is a repo name the visitor typed, scanned
 * first even if it would not have ranked: it is the one they came to see.
 *
 * `null` means GitHub would not list the user's repos — no such user, or the
 * API budget is spent. Both are "could not read that", the only failure a
 * visitor can act on.
 */
/** Repo-list pages read, 100 repos each. Past this the counts cover the most recently pushed repos, and say so. */
export const REPO_PAGES = 3;

/** The `rel="next"` URL from a GitHub Link header, or null on the last page. */
export function nextPageUrl(link: string | null): string | null {
  const next = link
    ?.split(',')
    .map((part) => part.trim())
    .find((part) => /rel="next"/.test(part));
  return next?.match(/<([^>]+)>/)?.[1] ?? null;
}

/**
 * A login's repos, most recently pushed first, up to REPO_PAGES pages.
 *
 * null only when GitHub says the login does not exist (404). Any other failure
 * on the first page throws GitHubUnavailableError: there is nothing true to show,
 * and "no such profile" would be false. A later page failing keeps what was read
 * and marks the list capped.
 */
export async function listRepos(login: string): Promise<{ repos: GhRepo[]; capped: boolean } | null> {
  let url: string | null =
    `https://api.github.com/users/${login}/repos?sort=pushed&direction=desc&per_page=100&type=owner`;
  const repos: GhRepo[] = [];
  for (let page = 0; url && page < REPO_PAGES; page++) {
    const read: Awaited<ReturnType<typeof readGitHub<GhRepo[]>>> = await readGitHub<GhRepo[]>(url);
    if (!read.data) {
      if (page > 0) return { repos, capped: true };
      if (read.status === 404) return null;
      throw new GitHubUnavailableError(read.status);
    }
    repos.push(...read.data);
    url = nextPageUrl(read.link);
  }
  return { repos, capped: url !== null };
}

/**
 * Repo names to try for a manifest: the typed repo first, then the ranking, each
 * once. Case-insensitive, because GitHub names are: a typed `MyRepo` used to be
 * scanned alongside GitHub's `myrepo`, and every one of its dependencies counted
 * twice. The typed name takes GitHub's spelling when the list has it.
 */
export function manifestTries(ranked: string[], featured: string | undefined, max: number): string[] {
  const spelled = new Map(ranked.map((name) => [name.toLowerCase(), name]));
  const seen = new Set<string>();
  const out: string[] = [];
  for (const name of [...(featured ? [spelled.get(featured.toLowerCase()) ?? featured] : []), ...ranked]) {
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(name);
    if (out.length === max) break;
  }
  return out;
}

export async function builderProfile(
  db: Database,
  login: string,
  featured?: string,
): Promise<BuilderProfile | null> {
  const listed = await listRepos(login);
  if (!listed) return null;
  const { repos, capped } = listed;

  const owned = repos.filter((r) => !r.fork);
  const canonical = repos[0]?.owner.login ?? login;

  // JS-ish first (a Go repo has no package.json to find), then stars, then recency.
  const ranked = owned
    .filter((r) => !r.archived)
    .sort(
      (a, b) =>
        Number(JS.has(b.language ?? '')) - Number(JS.has(a.language ?? '')) ||
        b.stargazers_count - a.stargazers_count ||
        (b.pushed_at ?? '').localeCompare(a.pushed_at ?? ''),
    )
    .map((r) => r.name);
  const tries = manifestTries(ranked, featured, MANIFEST_TRIES);

  // raw.githubusercontent is not the REST budget, so these can run together.
  const reads = await Promise.all(tries.map((name) => rootManifestRead(canonical, name)));
  // A 404 is a repo with no root package.json. Anything else is a read that did
  // not happen, and is reported as such rather than as a repo with nothing in it.
  const unreadManifests = tries.filter((_, i) => !reads[i]!.data && reads[i]!.status !== 404);
  const found = tries
    .flatMap((name, i) => (reads[i]!.data ? [{ name, manifest: reads[i]!.data }] : []))
    .slice(0, STACK_REPOS);
  const stacks = await Promise.all(
    found.map((f) => scanManifest(db, canonical, f.name, f.manifest)),
  );

  const now = Date.now();
  const traits = scoreTraits(repos, stacks, now);
  const languages = new Map<string, number>();
  for (const r of owned) {
    if (r.language) languages.set(r.language, (languages.get(r.language) ?? 0) + 1);
  }

  return {
    login: canonical,
    url: `https://github.com/${canonical}`,
    avatarUrl: `https://github.com/${canonical}.png?size=160`,
    archetype: pickArchetype(traits),
    traits,
    stats: {
      repos: owned.length,
      active90: activeRepos(repos, now),
      stars: owned.reduce((s, r) => s + r.stargazers_count, 0),
      languages: [...languages]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5)
        .map(([name, count]) => ({ name, repos: count })),
    },
    repos: stacks,
    coverage: { reposListed: repos.length, reposCapped: capped, unreadManifests },
  };
}
