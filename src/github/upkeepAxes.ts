/**
 * Upkeep axes beyond dependency currency.
 *
 * The builder report used to answer two questions — how active are you, and how
 * stale are your dependencies — and called the second one stewardship. That made
 * "upkeep" a synonym for "deps up to date", which is one axis of it. A project
 * also drifts when nothing declares which runtime it needs, and when nothing at
 * all is configured to keep it current.
 *
 * Same shape as `Trait` on purpose: `{ id, score, evidence }`, with `null`
 * meaning nothing was measurable and never a disguised zero, and evidence in
 * words the report can print under the number. An axis that cannot show its
 * facts is a checklist item, and a checklist is not what lurq has evidence for.
 *
 * Both functions here are pure. Everything they need is either already fetched
 * (the raw manifest) or a bounded set of known-path probes, so neither costs a
 * REST call on the anonymous budget that the public scan lives on.
 */
import semver from 'semver';

export type UpkeepAxisId = 'runtime' | 'automation';

export interface UpkeepAxis {
  id: UpkeepAxisId;
  /** 0–100. `null` when there was nothing to measure, never a disguised zero. */
  score: number | null;
  /** The facts the score came from, in words a report can print. */
  evidence: string[];
}

/**
 * The oldest Node major this scores as current.
 *
 * ponytail: a hand-set policy constant, exactly like the `k`s in `scoreTraits`.
 * It is NOT derived from upstream release data and must not pretend to be — it
 * is the line lurq draws, and it is here in one place so bumping it is a
 * one-line change rather than a hunt. Raise it when the ecosystem moves.
 */
export const SUPPORTED_NODE_FLOOR = 22;

/**
 * Files that prove something is configured to keep dependencies current.
 *
 * Known paths only, because a directory listing costs a REST call and the
 * anonymous budget is 60/hour server-wide. Probing known paths is what
 * `profileMcp` already does for agent configs, on the separate raw budget.
 *
 * Deliberately not a CI check: "does this repo run tests" cannot be proven by
 * guessing workflow filenames, and an axis that reports a guess is worse than
 * one that reports less.
 */
export const AUTOMATION_PATHS = [
  '.github/dependabot.yml',
  '.github/dependabot.yaml',
  'renovate.json',
  '.renovaterc.json',
  '.github/renovate.json',
  '.github/workflows/lurq-upgrade.yml',
] as const;

/** What a probe of one known path found. */
export interface UpkeepProbe {
  /** Repo-relative path that was probed. */
  path: string;
  /**
   * True when the file is there, false when GitHub answered 404, and `null`
   * when the read did not happen (rate limit, timeout). The third case is why
   * this is not a boolean: a probe that never ran is not a proven absence, the
   * same distinction `ProfileCoverage.unreadManifests` already draws.
   */
  present: boolean | null;
}

/** Human name for a configured robot, from the path that proved it. */
function toolFor(path: string): string {
  if (path.includes('dependabot')) return 'Dependabot';
  if (path.includes('renovate')) return 'Renovate';
  if (path.includes('lurq-upgrade')) return 'lurq autopilot';
  return path;
}

/**
 * Does the repo declare the runtime it needs, and is that floor still current?
 *
 * Reads the RAW manifest rather than a parsed one: `parseManifest` keeps only
 * dependency ranges and returns null for a repo with none, so a project with no
 * registry dependencies would otherwise have no axis at all — and "no
 * dependencies" is exactly the repo where the dependency report says nothing
 * and an upkeep read should still say something.
 */
export function runtimeAxis(raw: unknown): UpkeepAxis {
  if (!raw || typeof raw !== 'object') {
    return { id: 'runtime', score: null, evidence: ['no package.json was read'] };
  }
  const engines = (raw as { engines?: unknown }).engines;
  const declared =
    engines && typeof engines === 'object' ? (engines as { node?: unknown }).node : undefined;

  if (typeof declared !== 'string' || !declared.trim()) {
    return {
      id: 'runtime',
      // Zero, not null: nothing declaring a runtime IS the finding. `null` is
      // reserved for "we could not look", and here we looked.
      score: 0,
      evidence: ['no `engines.node`, so nothing states which Node this needs'],
    };
  }

  const floor = semver.validRange(declared) ? semver.minVersion(declared) : null;
  if (!floor) {
    return {
      id: 'runtime',
      score: 0,
      evidence: [`\`engines.node\` is \`${declared}\`, which is not a usable range`],
    };
  }

  const current = floor.major >= SUPPORTED_NODE_FLOOR;
  return {
    id: 'runtime',
    score: current ? 100 : 50,
    evidence: [
      `\`engines.node\` is \`${declared}\`, admitting Node ${floor.major} and up`,
      current
        ? `Node ${floor.major} is at or above the ${SUPPORTED_NODE_FLOOR} floor lurq scores as current`
        : `below the Node ${SUPPORTED_NODE_FLOOR} floor lurq scores as current`,
    ],
  };
}

/**
 * Is anything configured to keep this repo's dependencies current?
 *
 * Presence, not preference. A repo with Dependabot scores exactly what a repo
 * with lurq's own workflow scores, because ranking our own file higher inside a
 * report people share is marketing dressed as measurement. The difference
 * between them belongs in the evidence line, where the reader can weigh it.
 */
export function automationAxis(probes: UpkeepProbe[]): UpkeepAxis {
  const found = probes.filter((p) => p.present === true);
  const unread = probes.filter((p) => p.present === null);

  // Nothing answered, so nothing is known. Reporting 0 here would tell someone
  // their repo has no automation when the truth is that we could not look.
  if (found.length === 0 && unread.length === probes.length) {
    return {
      id: 'automation',
      score: null,
      evidence: probes.length
        ? ['none of the automation config paths could be read']
        : ['no repo was read'],
    };
  }

  const tools = [...new Set(found.map((p) => toolFor(p.path)))];
  const evidence = tools.length
    ? [`${tools.join(' and ')} configured to keep dependencies current`]
    : ['nothing configured to keep dependencies current'];
  if (unread.length > 0) {
    // Stated, because a partial read that found nothing is weaker evidence than
    // a complete one, and the number alone cannot say which it was.
    evidence.push(`${unread.length} config path(s) could not be read`);
  }

  return { id: 'automation', score: tools.length ? 100 : 0, evidence };
}
