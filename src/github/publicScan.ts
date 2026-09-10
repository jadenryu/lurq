/**
 * Scan a PUBLIC repo nobody has connected, from nothing but its name.
 *
 * The connected-repo path (manifests.ts → drift.ts) needs a GitHub App
 * installation, which needs an account, which needs a signup. That ordering is
 * backwards for a first-time visitor: the one thing that would make them sign
 * up is seeing their own dependencies in our numbers, and we were asking them
 * to sign up first. This reads a public repository over unauthenticated HTTP
 * and produces the same drift summary, so the landing page can show a person
 * their own stack before it asks them for anything.
 *
 * WHAT IT DELIBERATELY DOES NOT DO. No tree listing, so no workspace manifests:
 * a monorepo is read at its root package.json only. Fetching the tree costs an
 * authenticated API call per repo and the API's unauthenticated budget is 60 an
 * hour for the whole server, which one bored visitor exhausts for everybody.
 * The teaser is honest about being partial (`partial: true`) rather than
 * pretending the root is the whole repo.
 *
 * ponytail: root manifest only. Lift it to the full tree when this route has a
 * GITHUB_TOKEN in production and the API budget stops being the constraint.
 */
import { getConfig } from '../core/config';
import { logger } from '../core/logger';
import type { Database } from '../db/client';
import { computeDrift } from './drift';
import { parseManifest } from './manifests';
import { REPO_DRIFT_DETAIL_CAP, type DepDrift } from './types';

/** What a visitor typed, resolved to something fetchable. */
export type ScanTarget =
  | { kind: 'repo'; owner: string; name: string }
  | { kind: 'user'; login: string };

/** GitHub's own rule: alphanumerics and hyphens, no leading/trailing hyphen. */
const LOGIN = /^[a-z\d](?:[a-z\d]|-(?=[a-z\d])){0,38}$/i;
/**
 * Repo names are laxer: letters, digits, `.`, `_`, `-`. `.` and `..` are
 * excluded by name — a repo cannot be called either, and `owner/..` in a raw
 * URL normalizes away the owner segment, so it would scan whatever was left.
 * A leading dot is otherwise legal and real: `owner/.github` exists.
 */
const REPO = /^(?!\.\.?$)[\w.-]{1,100}$/;

/**
 * Read `owner/repo`, a github.com URL, a bare profile, or an `@handle`.
 *
 * Pure, and exported for its own test: this is the function that decides
 * whether a visitor's first interaction with lurq works, and every one of its
 * failure modes is a shrug rather than a throw.
 */
export function parseTarget(raw: string): ScanTarget | null {
  let input = raw.trim();
  if (!input) return null;

  // A pasted URL, with or without a scheme, with or without trailing path.
  input = input.replace(/^https?:\/\//i, '').replace(/^www\./i, '');
  if (input.toLowerCase().startsWith('github.com/')) input = input.slice('github.com/'.length);
  input = input.replace(/^@/, '').replace(/\.git$/i, '').replace(/\/+$/, '');

  const [owner, name] = input.split('/');
  if (!owner || !LOGIN.test(owner)) return null;
  if (!name) return { kind: 'user', login: owner };
  if (!REPO.test(name)) return null;
  return { kind: 'repo', owner, name };
}

function headers(): Record<string, string> {
  const token = getConfig().GITHUB_TOKEN;
  return {
    Accept: 'application/vnd.github+json',
    'User-Agent': 'lurq-public-scan',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}

/** Give up rather than hold a visitor's request open on a slow origin. */
const TIMEOUT_MS = 6_000;

async function getJson<T>(url: string, init?: RequestInit): Promise<T | null> {
  try {
    const res = await fetch(url, {
      ...init,
      headers: { ...headers(), ...(init?.headers ?? {}) },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

/**
 * The root `package.json` of a public repo, or null.
 *
 * `HEAD` rather than `main`: it resolves to whatever the default branch is
 * called, which saves a lookup and is right for the repos still on `master`.
 * raw.githubusercontent.com is a separate budget from the REST API, which is
 * the whole reason this path avoids the API for the common case.
 */
async function rootManifest(owner: string, name: string): Promise<unknown | null> {
  return getJson<unknown>(
    `https://raw.githubusercontent.com/${owner}/${name}/HEAD/package.json`,
    { headers: { Accept: 'application/json' } },
  );
}

/** How many of a profile's repos to try before giving up on finding a JS one. */
const PROFILE_TRIES = 5;

interface UserRepo {
  name: string;
  fork: boolean;
  archived: boolean;
  stargazers_count: number;
  pushed_at: string | null;
}

/**
 * A profile's most interesting JS/TS repo.
 *
 * Ordered by stars and then by recency, because the point is to show the
 * visitor something they recognise as theirs. Their most-starred repo is the
 * one they would have typed if we had asked for a repo.
 */
async function pickRepo(login: string): Promise<{ name: string; manifest: unknown } | null> {
  const repos = await getJson<UserRepo[]>(
    `https://api.github.com/users/${login}/repos?sort=pushed&direction=desc&per_page=30&type=owner`,
  );
  if (!repos?.length) return null;

  const ranked = repos
    .filter((r) => !r.fork && !r.archived)
    .sort(
      (a, b) =>
        b.stargazers_count - a.stargazers_count ||
        (b.pushed_at ?? '').localeCompare(a.pushed_at ?? ''),
    )
    .slice(0, PROFILE_TRIES);

  for (const repo of ranked) {
    const manifest = await rootManifest(login, repo.name);
    if (manifest) return { name: repo.name, manifest };
  }
  return null;
}

/** The shape the landing page renders. Flat on purpose: it crosses two hops. */
export interface PublicScan {
  /** `owner/name`, always resolved even when a profile was typed. */
  repo: string;
  url: string;
  depsDeclared: number;
  depsTracked: number;
  majorDrift: number;
  anyDrift: number;
  deprecated: number;
  advisories: number;
  /** Peer/engine conflicts if the repo took every available upgrade. */
  conflicts: number;
  /** Worst-first, capped. The evidence under the counts. */
  deps: DepDrift[];
  /** Always true today: the root manifest is not the whole repo. */
  partial: boolean;
}

/** How many dependency rows the teaser returns. Enough to be evidence, not a report. */
const TEASER_DEPS = 8;

/**
 * Public, unauthenticated scan of one repo or profile.
 *
 * Throws nothing a caller has to distinguish: `null` means "could not read a
 * package.json for that", which is the only failure a visitor can act on and
 * the only one worth a different message.
 */
export async function publicScan(db: Database, target: ScanTarget): Promise<PublicScan | null> {
  const resolved =
    target.kind === 'repo'
      ? await rootManifest(target.owner, target.name).then((manifest) =>
          manifest ? { owner: target.owner, name: target.name, manifest } : null,
        )
      : await pickRepo(target.login).then((hit) =>
          hit ? { owner: target.login, name: hit.name, manifest: hit.manifest } : null,
        );

  if (!resolved) return null;

  const manifest = parseManifest('package.json', resolved.manifest);
  const full = `${resolved.owner}/${resolved.name}`;
  const url = `https://github.com/${full}`;

  // A real repo with no registry dependencies. Not an error: it is a true and
  // slightly boring answer, and inventing a failure for it would send the
  // visitor looking for a typo they did not make.
  if (!manifest) {
    return {
      repo: full,
      url,
      depsDeclared: 0,
      depsTracked: 0,
      majorDrift: 0,
      anyDrift: 0,
      deprecated: 0,
      advisories: 0,
      conflicts: 0,
      deps: [],
      partial: true,
    };
  }

  const drift = await computeDrift(db, [manifest]);
  logger.debug(`public scan ${full}: ${drift.depsTracked}/${drift.depsDeclared} tracked`);

  return {
    repo: full,
    url,
    depsDeclared: drift.depsDeclared,
    depsTracked: drift.depsTracked,
    majorDrift: drift.majorDrift,
    anyDrift: drift.anyDrift,
    deprecated: drift.deprecated,
    advisories: drift.advisories,
    conflicts: drift.conflictsAtLatest?.length ?? 0,
    deps: drift.deps.slice(0, Math.min(TEASER_DEPS, REPO_DRIFT_DETAIL_CAP)),
    partial: true,
  };
}
