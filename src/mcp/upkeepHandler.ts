/**
 * The upkeep plan for a project, for an agent that is editing it right now.
 *
 * Everything else lurq exposes over MCP is argument-fed or index-backed: the
 * caller sends names and versions, never source, and the same tools work
 * whether lurq runs locally or hosted. This one is different on purpose — it
 * READS THE PROJECT, which is the only way to say "you call this, and it is
 * gone" rather than "a newer version exists". That is why it is registered on
 * the stdio server alone: on the hosted path the files are not there, and a
 * tool that silently answers about nothing is worse than a tool that is absent.
 *
 * Built to grow. `FixDomain` names five domains and four of them have
 * detectors; the dispatch table below is the seam, so adding `api` later is one
 * entry rather than a second tool. A domain that cannot run says why, and a
 * skipped domain is reported rather than quietly producing no findings —
 * "nothing found" and "never looked" must not read the same to a model.
 */
import type { FixDomain, Finding } from '../fix/types';

/** Source files read before a scan stops. A project past this says so. */
const SCAN_LIMIT = 20_000;

export interface UpkeepTarget {
  package: string;
  fromVersion: string;
  toVersion: string;
}

export interface UpkeepInput {
  /** Project root. Defaults to the process's working directory. */
  dir?: string;
  /**
   * Upgrades to assess. Optional, and its absence is why the package domain
   * may be skipped: working out what moved needs the index, and this tool is
   * deliberately usable with no API key.
   */
  upgrade?: UpkeepTarget[];
  /** Limit to these domains. Default: everything that can run. */
  domains?: FixDomain[];
}

export interface UpkeepReport {
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
const DOMAINS: Record<string, (root: string, input: UpkeepInput) => Promise<DomainResult>> = {
  /** Variables the code reads that no .env file declares. No key, no network. */
  env: async (root) => {
    const { envFindings } = await import('../fix/env');
    const plan = envFindings(root, { limit: SCAN_LIMIT });
    return { findings: plan.findings, truncated: plan.truncated };
  },

  /**
   * Model identifiers the provider has retired or put an end date on.
   *
   * Reads source only — no network, no key, no arguments. That is why it runs
   * by default: the check costs nothing the scan is not already paying, and
   * the failure it catches is one nothing else in the toolchain can see.
   */
  model: async (root) => {
    const { modelFindings } = await import('../fix/model');
    const plan = modelFindings(root, { limit: SCAN_LIMIT });
    return { findings: plan.findings, truncated: plan.truncated };
  },

  /**
   * Renames the package itself proves, the manifest ranges an upgrade leaves
   * stale, and a brief for everything that needs judgement.
   *
   * Reads the two published versions from npm, so it needs the network but no
   * API key — the same contract `check-upgrade` advertises.
   */
  package: async (root, input) => {
    const targets = input.upgrade ?? [];
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
    const refs = scanReferences(root, { limit: SCAN_LIMIT, stats });
    const report = await checkUpgrade(targets, refs, { rootDir: root });

    return {
      findings: [...renamePlan(report).findings, ...manifestFindings(root, targets).findings],
      truncated: stats.truncated,
    };
  },
};

/** Domains with a detector today. `api` is declared in FixDomain and has none. */
const AVAILABLE: FixDomain[] = ['env', 'model', 'package'];

export async function handleUpkeep(input: UpkeepInput = {}): Promise<UpkeepReport> {
  const root = input.dir?.trim() || process.cwd();
  const wanted = input.domains?.length ? input.domains : AVAILABLE;

  const findings: Finding[] = [];
  const ran: FixDomain[] = [];
  const skipped: UpkeepReport['skipped'] = [];
  let truncated = false;

  for (const domain of wanted) {
    const run = DOMAINS[domain];
    if (!run) {
      // Asked for by name but not built yet — said plainly, because a model
      // reading an empty result would otherwise conclude the project is clean.
      skipped.push({ domain, reason: `lurq has no detector for the ${domain} domain yet` });
      continue;
    }
    try {
      const result = await run(root, input);
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
