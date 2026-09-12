/**
 * Assessment: an inventory in, a findings report out.
 *
 * Runs where the index is — locally against Postgres, or on the hosted server
 * behind the `audit` tool. Either way it takes the WHOLE inventory at once,
 * because the alternative (a call per dependency) turns a forty-package project
 * into forty round trips and is the reason this is one tool rather than a loop
 * over `evaluate`.
 *
 * Everything here is batched: one indexed read for every package name, one OSV
 * post per hundred installs, one stored-surface read per MCP server. Cost grows
 * with the size of the user's project, which is the bound that makes the
 * feature affordable at all.
 *
 * The rule that governs every branch: an item we could not assess is reported
 * as unassessed, with a reason. Silence is never an all-clear.
 */
import { inArray } from 'drizzle-orm';
import semver from 'semver';
import { logger } from '../core/logger';
import type { Database } from '../db/client';
import { packages } from '../db/schema';
import { queryVulnerableInstalls } from '../ingestion/sources/osv';
import { contractOf, MCP_TIER } from '../surface/mcp';
import { fetchServerManifest, missingConfig } from '../surface/mcpRegistry';
import { loadStored, rowsToSurface } from '../mcp/surfaceHandlers';
import { enqueueSurface } from '../db/surface';
import type {
  AuditItem,
  AuditReport,
  Coverage,
  Finding,
  Inventory,
  InventoryMcpServer,
  InventoryPackage,
} from './types';

/** Postgres caps bind parameters; chunk `IN` lists well under it, as drift.ts does. */
const NAME_CHUNK = 500;

interface IndexRow {
  name: string;
  latestVersion: string | null;
  deprecated: boolean;
  advisories: { id: string; severity: string; summary: string }[] | null;
}

/** One indexed read for every discovered package name. */
async function loadIndexed(db: Database, names: string[]): Promise<Map<string, IndexRow>> {
  const out = new Map<string, IndexRow>();
  for (let i = 0; i < names.length; i += NAME_CHUNK) {
    const chunk = names.slice(i, i + NAME_CHUNK);
    const rows = await db
      .select({
        name: packages.name,
        latestVersion: packages.latestVersion,
        deprecated: packages.deprecated,
        advisories: packages.advisories,
      })
      .from(packages)
      .where(inArray(packages.name, chunk));
    for (const r of rows) out.set(r.name, r as IndexRow);
  }
  return out;
}

/** How far behind, phrased the way a reader decides with. */
function drift(installed: string, latest: string): Finding | null {
  const a = semver.coerce(installed);
  const b = semver.coerce(latest);
  if (!a || !b || semver.gte(a, b)) return null;
  const majors = b.major - a.major;
  if (majors > 0) {
    return {
      kind: 'outdated',
      severity: majors >= 2 ? 'moderate' : 'low',
      detail: `${installed} → ${latest} (${majors} major version${majors > 1 ? 's' : ''} behind; run \`lurq usage\` for the exact API delta before upgrading)`,
    };
  }
  if (b.minor > a.minor) {
    return {
      kind: 'outdated',
      severity: 'info',
      detail: `${installed} → ${latest} (minor versions behind)`,
    };
  }
  return {
    kind: 'outdated',
    severity: 'info',
    detail: `${installed} → ${latest} (patches behind)`,
  };
}

const OSV_SEVERITY: Finding['severity'] = 'high';

function assessPackage(
  pkg: InventoryPackage,
  idx: IndexRow | undefined,
  vulns: string[] | undefined,
): AuditItem {
  const item: AuditItem = {
    name: pkg.name,
    unit: 'npm',
    installed: pkg.installed,
    latest: idx?.latestVersion ?? null,
    status: 'answered',
    findings: [],
  };

  // Vulnerabilities FIRST, and independently of whether lurq has ever indexed
  // this package. OSV is keyed on name and version alone and needs nothing from
  // our catalogue, so gating it on an index hit suppressed the most dangerous
  // finding we produce behind an unrelated coverage gap — a fresh install of a
  // known-vulnerable package came back "nothing flagged" purely because we had
  // not ingested it yet.
  if (vulns?.length) {
    item.findings.push({
      kind: 'vulnerable',
      severity: OSV_SEVERITY,
      detail: `${pkg.installed} is affected by ${vulns.length} advisory(ies): ${vulns.slice(0, 4).join(', ')}${vulns.length > 4 ? ', …' : ''}`,
    });
  }

  if (!idx) {
    // The DRIFT question is unanswerable without the index — but "queued" now
    // means "we could not tell you how current it is", not "we did not look at
    // it", and any vulnerability above is already reported.
    item.status = 'queued';
    item.skipReason = 'not-in-index';
    return item;
  }

  if (idx.deprecated) {
    item.findings.push({
      kind: 'deprecated',
      severity: 'moderate',
      detail: 'the publisher has marked this package deprecated',
    });
  }

  // The index's `advisories` column is a package-level count, true of the
  // package rather than of any one version. It only speaks when there is no
  // install to run the exact-version check against.
  if (!pkg.installed && (idx.advisories?.length ?? 0) > 0) {
    item.findings.push({
      kind: 'vulnerable',
      severity: 'moderate',
      detail: `${idx.advisories!.length} advisory(ies) recorded against this package; nothing is installed, so no exact-version check was possible`,
    });
  }

  if (pkg.installed && idx.latestVersion) {
    const d = drift(pkg.installed, idx.latestVersion);
    if (d) item.findings.push(d);
  } else if (!pkg.installed) {
    item.status = 'skipped';
    item.skipReason = 'not-installed';
  }

  return item;
}

/** Tools whose declared behaviour lets them change something outside the agent. */
function privilegeSummary(tools: { annotations: Record<string, boolean> }[]): {
  writes: number;
  destroys: number;
} {
  return {
    writes: tools.filter((t) => !t.annotations.readOnlyHint).length,
    destroys: tools.filter((t) => t.annotations.destructiveHint).length,
  };
}

async function assessMcpServer(db: Database, s: InventoryMcpServer): Promise<AuditItem> {
  const name = s.packageName ?? s.endpoint ?? s.alias;
  const item: AuditItem = {
    name,
    unit: 'mcp',
    installed: s.version,
    latest: null,
    status: 'answered',
    findings: [],
  };

  if (s.kind !== 'npm-stdio' || !s.packageName) {
    item.status = 'skipped';
    item.skipReason = 'not-npm';
    item.findings.push({
      kind: 'contract-drift',
      severity: 'info',
      detail:
        s.kind === 'remote'
          ? `hosted at ${s.endpoint ?? 'an endpoint'}; there is no package to install, so lurq's stdio probe does not apply and its contract can change with no version to observe`
          : s.kind === 'other-registry'
            ? 'launched from a registry lurq does not index (PyPI or similar)'
            : 'launched from a local path, so there is no published artifact to compare against',
    });
    return item;
  }

  // What the server declares it needs, whether or not it has been probed. An
  // agent about to use it wants this before the first call, not after.
  const manifest = await fetchServerManifest(s.packageName).catch(() => null);
  const missing = missingConfig(manifest);
  if (missing.length) {
    item.findings.push({
      kind: 'needs-config',
      severity: 'moderate',
      detail: `needs ${missing.map((m) => m.name).join(', ')} before it will start${missing.some((m) => m.secret) ? ' (at least one is a credential — ask the user, never guess)' : ''}`,
    });
  }

  const stored = await loadStored(db, s.packageName, s.version, 0, 'mcp_server');
  if (!stored || stored.rows.length === 0) {
    await enqueueSurface(db, s.packageName, s.version, 'mcp_server').catch(() => {});
    item.status = 'queued';
    item.skipReason = 'never-probed';
    return item;
  }
  if (stored.verdict === 'verified_false') {
    item.findings.push({
      kind: 'contract-drift',
      severity: 'high',
      detail: 'probed and it did not complete the MCP handshake in a clean install',
    });
    return item;
  }

  const surface = rowsToSurface(s.packageName, s.version, stored.rows, MCP_TIER);
  const annotated = surface.symbols.map((sym) => ({
    annotations: contractOf(sym)?.annotations ?? {
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: false,
      openWorldHint: true,
    },
  }));
  const { writes, destroys } = privilegeSummary(annotated);
  if (destroys > 0) {
    item.findings.push({
      kind: 'privilege',
      severity: 'low',
      detail: `${surface.symbols.length} tool(s); ${writes} can write and ${destroys} declare destructive effects`,
    });
  }

  // The version question, answered honestly. An unpinned server floats to
  // whatever latest is at spawn time, so there is no "your version" to compare
  // and the only sound statement is that the contract is unobservable.
  if (!s.version) {
    item.skipReason = 'unpinned';
    item.findings.push({
      kind: 'contract-drift',
      severity: 'moderate',
      detail:
        'launched unpinned, so every start may fetch a different build; lurq cannot tell you what changed because your config never named a version. Pin it to make drift observable.',
    });
  }

  return item;
}

export interface AssessOptions {
  /** Injected for tests; defaults to the real OSV client. */
  vulnLookup?: typeof queryVulnerableInstalls;
}

export async function assessInventory(
  db: Database,
  inv: Inventory,
  opts: AssessOptions = {},
): Promise<AuditReport> {
  const lookup = opts.vulnLookup ?? queryVulnerableInstalls;
  const names = inv.packages.map((p) => p.name);
  const indexed = await loadIndexed(db, names);

  // One OSV round trip for the WHOLE tree — directs and transitives together.
  // Transitives are where most real exposure lives and are invisible from a
  // manifest, so leaving them out would make a clean report mean very little.
  const installs = [
    ...inv.packages
      .filter((p): p is InventoryPackage & { installed: string } => p.installed !== null)
      .map((p) => ({ name: p.name, version: p.installed })),
    ...inv.transitives.map((t) => ({ name: t.name, version: t.version })),
  ];
  let affected = new Map<string, string[]>();
  let vulnComplete = true;
  try {
    const res = await lookup(installs);
    affected = res.affected;
    vulnComplete = res.complete;
  } catch (err) {
    // A failed lookup is NOT an all-clear. The flag is what stops the report
    // from printing "0 vulnerabilities" over a request that never landed.
    vulnComplete = false;
    logger.warn({ err: String(err) }, 'audit: vulnerability lookup failed');
  }

  const items: AuditItem[] = [];
  for (const p of inv.packages) {
    const item = assessPackage(
      p,
      indexed.get(p.name),
      p.installed ? affected.get(`${p.name}@${p.installed}`) : undefined,
    );
    items.push(item);
  }

  // Transitives surface ONLY when something is wrong. A thousand healthy
  // inherited packages are not a finding, and listing them would bury the forty
  // direct dependencies the user can actually act on.
  for (const t of inv.transitives) {
    const vulns = affected.get(`${t.name}@${t.version}`);
    if (!vulns?.length) continue;
    items.push({
      name: t.name,
      unit: 'transitive',
      installed: t.version,
      latest: null,
      status: 'answered',
      via: t.via,
      findings: [
        {
          kind: 'vulnerable',
          severity: OSV_SEVERITY,
          detail:
            `${t.version} is affected by ${vulns.length} advisory(ies): ${vulns.slice(0, 4).join(', ')}${vulns.length > 4 ? ', …' : ''}` +
            // Without this the finding is unactionable: nobody installed the
            // transitive on purpose, so the fix is always at a direct dep.
            (t.via.length
              ? ` — pulled in via ${t.via.slice(0, 3).join(', ')}${t.via.length > 3 ? ` and ${t.via.length - 3} more` : ''}`
              : ' — no path recorded in the lockfile'),
        },
      ],
    });
  }

  for (const s of inv.mcpServers) {
    items.push(await assessMcpServer(db, s));
  }

  // `discovered` counts what the user declared, not what the tree contains: the
  // answered fraction has to stay a statement about their dependencies, and a
  // thousand transitives would drown it.
  const declared = items.filter((i) => i.unit !== 'transitive');
  const coverage: Coverage = {
    discovered: declared.length,
    answered: declared.filter((i) => i.status === 'answered').length,
    queued: declared.filter((i) => i.status === 'queued').length,
    skipped: declared.filter((i) => i.status === 'skipped').length,
    transitivesChecked: inv.transitives.length,
    treeRead: inv.transitives.length > 0,
    vulnComplete,
  };

  const notes = [...inv.notes];
  if (!vulnComplete) {
    notes.push(
      'the vulnerability lookup did not complete, so vulnerability results are PARTIAL — absence of a finding here is not an all-clear',
    );
  }
  if (coverage.queued) {
    notes.push(
      `${coverage.queued} item(s) are not in the index yet and have been queued; re-run shortly for a complete answer`,
    );
  }

  return { root: inv.root, items, coverage, notes, dataAsOf: new Date().toISOString() };
}

/**
 * Feed the misses back into ingestion, so the next audit of this project is
 * more complete than this one.
 *
 * This is the mechanism behind the coverage promise. The index has only ever
 * held packages somebody already asked about, so an ordinary project's audit
 * starts out mostly "not in the index" — and stays that way unless the misses
 * are fed back. `github/drift.ts` solved the same problem for repo scans with
 * the same call; this is that fix applied to the local path.
 *
 * It must be `enqueueIngest`, NOT `enqueueSurface`. A surface is keyed to a
 * package the index already has, so queueing one for a package that was never
 * ingested schedules work against a row that does not exist — and the report
 * would say "queued" about something nothing was ever going to pick up. A
 * status the user can wait on has to be true.
 *
 * Fire-and-forget and hard-capped upstream: nothing here can slow or fail the
 * audit that triggered it.
 */
export async function queueUnknown(
  db: Database,
  report: AuditReport,
  ownerId: string | null = null,
): Promise<number> {
  const names = report.items
    .filter((i) => i.unit === 'npm' && i.skipReason === 'not-in-index')
    .map((i) => i.name);
  if (names.length === 0) return 0;
  try {
    // The module load is awaited rather than fired and forgotten. With `void
    // import(...)` the enqueue happens a microtask later, so a caller that
    // queues and then drains finds an EMPTY queue, drains nothing, and reports
    // "queued" about work that was never scheduled. `enqueueIngest` itself
    // still returns without awaiting any network, so this costs the caller
    // nothing and makes the returned count true.
    const { enqueueIngest } = await import('../pipeline/ingestQueue');
    for (const name of names) enqueueIngest(db, name, ownerId);
  } catch (err) {
    // Ingestion improves the NEXT audit; this one still reports fully.
    logger.debug(`audit: untracked-dep enqueue failed: ${String(err)}`);
    return 0;
  }
  return names.length;
}
