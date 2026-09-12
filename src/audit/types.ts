/**
 * Shapes for `lurq audit` — the whole-project read.
 *
 * The organising idea is the DENOMINATOR. lurq's index covers a small fraction
 * of npm and a smaller fraction of the MCP registry, and chasing registry-wide
 * coverage is what kept the diffable store at ~2.9k packages while `usage` —
 * which answers on demand, within a budget — reached ten times that. So this
 * feature never asks "how much of the world do we know". It asks "how much of
 * THIS project do we know", which is forty-odd dependencies and a handful of
 * servers: bounded, affordable, and the only number the person asking can
 * actually perceive.
 *
 * Which makes the coverage accounting load-bearing rather than decorative.
 * Every discovered item lands in exactly one bucket — answered, queued, or
 * skipped with a stated reason — and the report prints the fractions. A
 * dependency we did not look at must never be counted as one we found nothing
 * wrong with; that is the same rule `github/drift.ts` and `surface/upgrade.ts`
 * already hold, applied to a surface the user sees directly.
 */

/** Where a dependency came from, so a finding can be traced back to a file. */
export interface ItemSource {
  /** Path relative to the audited directory. */
  file: string;
  /** `dependencies`, `devDependencies`, `mcpServers`, … */
  section: string;
}

/** How an MCP server is launched, which decides whether lurq can read it. */
export type McpKind =
  /** `npx <pkg>` — an npm package lurq can install and probe. */
  | 'npm-stdio'
  /** A hosted endpoint. Nothing to install; the stdio probe does not apply. */
  | 'remote'
  /** A local binary or script path. Not reproducible from a registry. */
  | 'local'
  /** A package manager lurq does not index (uvx/pipx → PyPI, etc.). */
  | 'other-registry';

export interface InventoryPackage {
  name: string;
  /** The declared range, e.g. `^6.4.0`. */
  range: string;
  /**
   * What is actually installed, from the lockfile or node_modules.
   *
   * Null when nothing has been installed yet. This is the version that matters:
   * a range says what is permitted, an install says what runs, and a
   * vulnerability applies to the second.
   */
  installed: string | null;
  sources: ItemSource[];
}

export interface InventoryMcpServer {
  /** The key in the config, e.g. `github`. Not necessarily the package name. */
  alias: string;
  kind: McpKind;
  /** npm package name, when `kind` is `npm-stdio`. */
  packageName: string | null;
  /**
   * Pinned version, when the config names one.
   *
   * Almost always null in practice: `npx -y <pkg>` floats to whatever latest is
   * at spawn time. That is why this feature cannot be built as "you are on X,
   * latest is Y" — for MCP there is usually no X.
   */
  version: string | null;
  /** Host, for a remote server. */
  endpoint: string | null;
  sources: ItemSource[];
}

export interface Inventory {
  /** Absolute path that was audited. */
  root: string;
  packages: InventoryPackage[];
  mcpServers: InventoryMcpServer[];
  /** Manifests and configs actually read, for the report's provenance line. */
  filesRead: string[];
  /** Discovery problems — a malformed config is reported, never swallowed. */
  notes: string[];
}

export type Severity = 'critical' | 'high' | 'moderate' | 'low' | 'info';

/** Why an item could not be assessed. Never absent when `status` is not `answered`. */
export type SkipReason =
  | 'not-in-index'
  | 'not-installed'
  | 'never-probed'
  | 'unpinned'
  | 'not-npm'
  | 'truncated';

export interface Finding {
  kind: 'outdated' | 'deprecated' | 'vulnerable' | 'contract-drift' | 'privilege' | 'needs-config';
  severity: Severity;
  /** One line, specific enough to act on without opening anything else. */
  detail: string;
}

export interface AuditItem {
  name: string;
  /** `npm` or `mcp` — which half of the report this belongs to. */
  unit: 'npm' | 'mcp';
  installed: string | null;
  latest: string | null;
  status: 'answered' | 'queued' | 'skipped';
  skipReason?: SkipReason;
  findings: Finding[];
}

/**
 * The denominator, stated rather than implied.
 *
 * `vulnComplete` is separate on purpose: an OSV request that failed returns no
 * vulnerabilities, which is indistinguishable from a clean result unless the
 * report says so. Reporting "0 vulnerabilities" after a failed lookup is the
 * single most dangerous thing this feature could do.
 */
export interface Coverage {
  discovered: number;
  answered: number;
  queued: number;
  skipped: number;
  /** Every OSV batch came back. False means vulnerability results are partial. */
  vulnComplete: boolean;
}

export interface AuditReport {
  root: string | null;
  items: AuditItem[];
  coverage: Coverage;
  notes: string[];
  dataAsOf: string;
}

/** Ordering for display: the thing that can hurt you goes first. */
export const SEVERITY_RANK: Record<Severity, number> = {
  critical: 0,
  high: 1,
  moderate: 2,
  low: 3,
  info: 4,
};

export function worstSeverity(findings: Finding[]): Severity | null {
  if (findings.length === 0) return null;
  return findings.reduce(
    (worst, f) => (SEVERITY_RANK[f.severity] < SEVERITY_RANK[worst] ? f.severity : worst),
    findings[0]!.severity,
  );
}
