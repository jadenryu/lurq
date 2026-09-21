/**
 * What is wrong with a project, across every domain lurq can detect.
 *
 * This is the one place that answers that question. It used to live inside the
 * MCP handler, which made it the MCP tool's private knowledge: `lurq fix` — the
 * command the autopilot runs in CI — reached past it straight to `renamePlan`
 * and `manifestFindings`, so it only ever knew about packages. The result was
 * two detector pipelines with one visible. An undeclared environment variable
 * or a retired model id could be found by an agent that thought to ask, and by
 * nothing else: not a pull request, not the runs log, not a person. A detector
 * nothing routes to is a detector nobody has.
 *
 * So the table moved down here, beside the detectors it dispatches to, and both
 * callers share it. `src/mcp/upkeepHandler.ts` is the MCP face of it and
 * `runFix` is the command-line one; neither owns it.
 *
 * Built to grow. `FixDomain` names five domains and four of them have
 * detectors; the dispatch table below is the seam, so adding `api` later is one
 * entry rather than a second tool. A domain that cannot run says why, and a
 * skipped domain is reported rather than quietly producing no findings —
 * "nothing found" and "never looked" must not read the same to a caller.
 */
import type { FixDomain, Finding } from './types';

/** Source files read before a scan stops. A project past this says so. */
export const DOMAIN_SCAN_LIMIT = 20_000;

export interface DomainTarget {
  package: string;
  fromVersion: string;
  toVersion: string;
}

export interface DomainInput {
  /** Project root. Defaults to the process's working directory. */
  dir?: string;
  /**
   * Upgrades to assess. Optional, and its absence is why the package domain
   * may be skipped: working out what moved needs the index, and this tool is
   * deliberately usable with no API key.
   */
  upgrade?: DomainTarget[];
  /** Limit to these domains. Default: everything that can run. */
  domains?: FixDomain[];
  /**
   * Source files to read before a scan stops. Defaults to
   * `DOMAIN_SCAN_LIMIT`, and lowered by a caller that is holding up a person —
   * the session-start hook has a few seconds before the prompt appears, and a
   * bounded partial answer there beats a complete one nobody waited for.
   */
  limit?: number;
}

export interface DomainReport {
  root: string;
  /** Domains that actually ran. */
  ran: FixDomain[];
  /** Domains that did not, and why — never silently empty. */
  skipped: { domain: FixDomain; reason: string }[];
  findings: Finding[];
  /**
   * A source file past the scan limit was never opened, so this is not a
   * complete answer. Reported rather than folded into a clean result.
   */
  truncated: boolean;
}

interface DomainResult {
  findings: Finding[];
  truncated?: boolean;
  /** Set when the domain could not run at all. */
  skipped?: string;
}

/**
 * One entry per domain. The whole point of the table: a new domain is a new
 * entry, not a new tool and not another branch in a handler.
 */
const DOMAINS: Record<string, (root: string, opts: DomainInput) => Promise<DomainResult>> = {
  /** Variables the code reads that no .env file declares. No key, no network. */
  env: async (root, opts) => {
    const { envFindings } = await import('../fix/env');
    const plan = envFindings(root, { limit: opts.limit ?? DOMAIN_SCAN_LIMIT });
    return { findings: plan.findings, truncated: plan.truncated };
  },

  /**
   * Model identifiers the provider has retired or put an end date on.
   *
   * Reads source only — no network, no key, no arguments. That is why it runs
   * by default: the check costs nothing the scan is not already paying, and
   * the failure it catches is one nothing else in the toolchain can see.
   */
  model: async (root, opts) => {
    const { modelFindings } = await import('../fix/model');
    const plan = modelFindings(root, { limit: opts.limit ?? DOMAIN_SCAN_LIMIT });
    return { findings: plan.findings, truncated: plan.truncated };
  },

  /**
   * Renames the package itself proves, the manifest ranges an upgrade leaves
   * stale, and a brief for everything that needs judgement.
   *
   * Reads the two published versions from npm, so it needs the network but no
   * API key — the same contract `check-upgrade` advertises.
   */
  package: async (root, opts) => {
    const targets = opts.upgrade ?? [];
    if (targets.length === 0) {
      return {
        findings: [],
        skipped:
          'no upgrades given. Pass `upgrade` with the versions to assess, or run `lurq fix` in the project to have them worked out from the index.',
      };
    }
    const { scanReferences } = await import('../surface/references');
    const { checkUpgrade } = await import('../surface/upgrade');
    const { renamePlan } = await import('../fix/rename');
    const { manifestFindings } = await import('../fix/manifest');

    const stats = { files: 0, truncated: false };
    const refs = scanReferences(root, { limit: opts.limit ?? DOMAIN_SCAN_LIMIT, stats });
    const report = await checkUpgrade(targets, refs, { rootDir: root });

    return {
      findings: [...renamePlan(report).findings, ...manifestFindings(root, targets).findings],
      truncated: stats.truncated,
    };
  },
};

/** Domains with a detector today. `api` is declared in FixDomain and has none. */
export const AVAILABLE: FixDomain[] = ['env', 'model', 'package'];

/**
 * The domains that need nothing but the source tree.
 *
 * `package` is the odd one out: it cannot say anything without a version pair
 * to compare, which has to come from the index or from the user. These can
 * always run, which is what lets `runFix` report them on a repository whose
 * every dependency is current — the case where it used to print "nothing to
 * fix" over a retired model id sitting in the source.
 */
export const SOURCE_DOMAINS: FixDomain[] = AVAILABLE.filter((d) => d !== 'package');

export async function runDomains(opts: DomainInput = {}): Promise<DomainReport> {
  const root = opts.dir?.trim() || process.cwd();
  const wanted = opts.domains?.length ? opts.domains : AVAILABLE;

  const findings: Finding[] = [];
  const ran: FixDomain[] = [];
  const skipped: DomainReport['skipped'] = [];
  let truncated = false;

  for (const domain of wanted) {
    const run = DOMAINS[domain];
    if (!run) {
      // Asked for by name but not built yet — said plainly, because a caller
      // reading an empty result would otherwise conclude the project is clean.
      skipped.push({ domain, reason: `lurq has no detector for the ${domain} domain yet` });
      continue;
    }
    try {
      const result = await run(root, opts);
      if (result.skipped) {
        skipped.push({ domain, reason: result.skipped });
        continue;
      }
      findings.push(...result.findings);
      if (result.truncated) truncated = true;
      ran.push(domain);
    } catch (err) {
      // One domain failing must not take the others with it, and the failure
      // is reported as a skip rather than as a clean domain.
      skipped.push({ domain, reason: err instanceof Error ? err.message : String(err) });
    }
  }

  return { root, ran, skipped, findings, truncated };
}
