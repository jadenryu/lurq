/**
 * Human-facing CLI command implementations (§13). Each gets a result from the
 * index (the hosted service, or a local database), then renders a compact
 * table/detail view, or raw JSON with `--json`.
 */
import semver from 'semver';
import { loadEnv, requireConfig } from '../core/config';
import { openInBrowser } from '../core/open';
import { resolveApiKey } from '../core/userConfig';
import { isCategory, type Category, type Confidence } from '../core/types';
import { createDb } from '../db/client';
import { getPackageVersions } from '../db/packages';
import { handleCompare, handleEvaluate, handleRecommend, handleVerify } from '../mcp/handlers';
import { CONFIDENCE, QUALITY_WEIGHTS } from '../scoring/weights';
import {
  activeWeightsPath,
  applyOverrides,
  loadWeights,
  resetWeights,
  saveWeights,
  settableKeys,
  validateWeights,
  WEIGHT_EXPLANATIONS,
} from '../scoring/weights';
import {
  bold,
  confidenceLabel,
  detail,
  dim,
  formatDate,
  formatNumber,
  formatPercent,
  green,
  red,
  table,
  yellow,
} from './format';

async function withDb<T>(fn: (db: ReturnType<typeof createDb>['db']) => Promise<T>): Promise<T> {
  requireConfig(['DATABASE_URL']);
  const handle = createDb();
  try {
    return await fn(handle.db);
  } finally {
    await handle.close();
  }
}

/**
 * Which index a read command should answer from.
 *
 * An API key wins over DATABASE_URL, and that order is deliberate. dotenv loads
 * the `.env` of whatever directory the CLI is invoked in, so for a normal user
 * (someone who ran `lurq setup` and then typed `lurq recommend` inside their
 * own Postgres-backed app), DATABASE_URL is *their application's* database.
 * Checking it first would point package lookups at a schema that has never
 * heard of lurq and fail with a confusing SQL error. Operators and
 * self-hosters, who have a DATABASE_URL and no key, still get the local path;
 * anyone holding both can force it with LURQ_LOCAL=1.
 */
export function indexSource(): 'hosted' | 'local' {
  loadEnv();
  if (process.env.LURQ_LOCAL === '1') return 'local';
  if (resolveApiKey()) return 'hosted';
  if (process.env.DATABASE_URL) return 'local';
  throw new Error(
    'No API key configured. Run `lurq setup` to connect this machine, ' +
      'or set DATABASE_URL to read from your own index.',
  );
}

/**
 * Run one read command against whichever index is configured.
 *
 * The hosted tools return exactly what the local handler returns (mcp/server.ts
 * wraps every handler result as a single JSON text block), so both paths hand
 * back the same shape and the caller renders it once. The one difference is
 * that the hosted path has been through `compact`, which drops null fields and
 * empty arrays, hence the `?? []` guards in the renderers below.
 */
async function fromIndex<T>(
  tool: string,
  args: Record<string, unknown>,
  local: (db: ReturnType<typeof createDb>['db']) => Promise<T>,
): Promise<T> {
  if (indexSource() === 'local') return withDb(local);
  const { callTool } = await import('./remote');
  return callTool<T>(tool, args);
}

export interface RecommendCliOpts {
  category?: string;
  minConfidence?: string;
  json?: boolean;
}

export async function runRecommend(need: string, opts: RecommendCliOpts): Promise<void> {
  if (opts.category && !isCategory(opts.category)) {
    throw new Error(`Unknown category "${opts.category}".`);
  }
  const args = {
    need,
    category: opts.category as Category | undefined,
    constraints: opts.minConfidence
      ? { minConfidence: opts.minConfidence as Confidence }
      : undefined,
  };
  const res = await fromIndex('recommend', args, (db) => handleRecommend(db, args));

  if (opts.json) return console.log(JSON.stringify(res, null, 2));
  const candidates = res.candidates ?? [];
  if (candidates.length === 0) {
    console.log('No matching packages found.');
    return;
  }
  console.log(
    table(
      ['Package', 'Health', 'Quality', 'Confidence', 'Weekly', 'Latest', 'Category'],
      candidates.map((c) => [
        c.name,
        String(c.healthScore),
        c.qualityScore != null ? String(c.qualityScore) : '—',
        confidenceLabel(c.confidence),
        formatNumber(c.weeklyDownloads),
        c.latestVersion ?? '—',
        c.category ?? '—',
      ]),
    ),
  );
  printExclusions(res);
  console.log(dim(`\ndata as of ${formatDate(res.dataAsOf)}`));
}

/**
 * Show what a selection policy refused, when one is in force.
 *
 * policy/types.ts is explicit that exclusions are reported and never silently
 * dropped, for a concrete reason: told "here are 3 options" when 5 were found,
 * an agent re-derives the blocked one from training and installs it directly.
 * The same holds for a person at a terminal. The hosted path is the one that
 * carries a verdict at all, since policy is owner-scoped and the local path
 * passes no owner.
 */
function printExclusions(res: object): void {
  if (!('excluded' in res)) return;
  const excluded = (res.excluded ?? []) as { name: string; rule: string; reason: string }[];
  if (excluded.length === 0) return;
  console.log(yellow(`\npolicy refused ${excluded.length}:`));
  for (const e of excluded) console.log(`  ${e.name}  ${dim(`${e.rule}: ${e.reason}`)}`);
}

export async function runEvaluate(pkg: string, opts: { json?: boolean }): Promise<void> {
  const res = await fromIndex('evaluate', { package: pkg }, (db) =>
    handleEvaluate(db, { package: pkg }),
  );

  if (opts.json) return console.log(JSON.stringify(res, null, 2));
  if ('tracked' in res) {
    console.log(res.suggestion);
    return;
  }
  console.log(bold(res.name) + (res.category ? dim(`  (${res.category})`) : ''));
  // A blocked verdict is the most actionable line in the whole output, so it
  // goes above the scores rather than after them. Absent means "no rules
  // configured", never "allowed": see PolicyVerdict in policy/types.ts.
  if (res.policy) {
    console.log(
      res.policy.allowed
        ? green('policy: allowed')
        : red(`policy: blocked (${res.policy.rule}): ${res.policy.reason}`),
    );
  }
  // Every component can be null for a barely-tracked package, and `compact`
  // drops the whole object once they are, so this is absent, not just empty.
  const b = res.scoreBreakdown ?? {};
  const advisories = res.advisories ?? [];
  console.log(
    detail([
      ['health', `${res.healthScore}  ${confidenceLabel(res.confidence)}`],
      ['quality', res.qualityScore != null ? String(res.qualityScore) : '—'],
      [
        'breakdown',
        `maint ${b.maintenance ?? '—'} · adopt ${b.adoption ?? '—'} · rel ${b.reliability ?? '—'} · eff ${b.efficiency ?? '—'} · qual ${b.quality ?? '—'}`,
      ],
      ['version', res.latestVersion ?? '—'],
      ['weekly dl', `${formatNumber(res.weeklyDownloads)}  (${formatPercent(res.downloadGrowth90d)} 90d)`],
      ['scorecard', res.scorecard != null ? String(res.scorecard) : '—'],
      ['bundle', res.bundleMinGzipKb != null ? `${res.bundleMinGzipKb} KB gzip` : '—'],
      ['released', formatDate(res.lastReleaseAt)],
      ['flags', [res.deprecated && 'deprecated', res.archived && 'archived'].filter(Boolean).join(', ') || 'none'],
      ['advisories', advisories.length ? advisories.map((a) => `${a.severity}`).join(', ') : 'none'],
      ['repo', res.repoUrl ?? '—'],
    ]),
  );
  if (res.buildVerified) {
    const bv = res.buildVerified;
    const state = !bv.installed
      ? red('install failed')
      : bv.loaded === false
        ? yellow('installs, load failed')
        : green('installs and loads');
    console.log(`\nsandbox: ${state}  ${dim(`${bv.version} · ${bv.driver}`)}`);
  }
  if (res.summary) console.log('\n' + res.summary);
  if (res.usageGuide) {
    const g = res.usageGuide;
    console.log(
      '\n' +
        detail(
          [
            ['what', g.whatItIs],
            ['when', g.whenToUse],
            g.whenNotToUse ? (['when not', g.whenNotToUse] as [string, string]) : null,
            ['fits', g.whereItFits],
            g.howToWireIn ? (['wire-in', g.howToWireIn] as [string, string]) : null,
          ].filter(Boolean) as [string, string][],
        ),
    );
  }
  console.log(dim(`\ndata as of ${formatDate(res.dataAsOf)}${res.stale ? '  (stale)' : ''}`));
}

export async function runCompare(pkgs: string[], opts: { json?: boolean }): Promise<void> {
  const res = await fromIndex('compare', { packages: pkgs }, (db) =>
    handleCompare(db, { packages: pkgs }),
  );

  if (opts.json) return console.log(JSON.stringify(res, null, 2));
  console.log(
    table(
      ['Package', 'Health', 'Confidence', 'Weekly', '90d', 'Scorecard', 'Released'],
      (res.rows ?? []).map((r) => [
        r.name,
        String(r.healthScore),
        confidenceLabel(r.confidence),
        formatNumber(r.weeklyDownloads),
        formatPercent(r.downloadGrowth90d),
        r.scorecard != null ? String(r.scorecard) : '—',
        formatDate(r.lastReleaseAt),
      ]),
    ),
  );
  // Two causes, two lines. A name that is not on npm is a red flag the user has
  // to act on; a package still being ingested is a "try again in a moment". The
  // single dim line these used to share said "not found" for both.
  // `?? []` for the older-server case where only the union `missing` came back:
  // report it under the cautious heading rather than silently dropping it.
  const notFound = res.notFound ?? (res.pending ? [] : (res.missing ?? []));
  if (notFound.length) console.log(red(`\nnot on npm: ${notFound.join(', ')}`));
  if (res.pending?.length) {
    console.log(dim(`\nbeing scored now (retry shortly): ${res.pending.join(', ')}`));
  }
  console.log(dim(`data as of ${formatDate(res.dataAsOf)}`));
}

// ── weights / edit-weights (§4) ──────────────────────────────────────────────

/** `lurq weights` — show + explain the score model (no DB needed). */
export function runWeights(opts: { json?: boolean } = {}): void {
  const w = loadWeights();
  const active = activeWeightsPath();
  if (opts.json) {
    console.log(JSON.stringify({ ...w, source: active?.source ?? 'defaults' }, null, 2));
    return;
  }
  const pct = (n: number) => n.toFixed(2);
  console.log(bold('Two axes, blended for default sort:'));
  console.log(`  composite = (1−λ)·health + λ·quality      λ = ${pct(w.composite.lambda)}\n`);
  console.log(bold('Health (proven-ness) — weighted sum of 4 components:'));
  console.log(
    detail([
      ['maintenance', `${pct(w.health.maintenance)}  ${dim('— ' + WEIGHT_EXPLANATIONS.maintenance!)}`],
      ['adoption', `${pct(w.health.adoption)}  ${dim('— ' + WEIGHT_EXPLANATIONS.adoption!)}`],
      ['reliability', `${pct(w.health.reliability)}  ${dim('— ' + WEIGHT_EXPLANATIONS.reliability!)}`],
      ['efficiency', `${pct(w.health.efficiency)}  ${dim('— ' + WEIGHT_EXPLANATIONS.efficiency!)}`],
    ]),
  );
  console.log('\n' + bold('Quality (intrinsic, adoption-independent):'));
  console.log('  ' + dim(Object.keys(QUALITY_WEIGHTS).join(', ')));
  console.log('\n' + bold('Confidence thresholds:'));
  console.log(
    detail([
      ['proven', `≥ ${formatNumber(CONFIDENCE.proven.minWeeklyDownloads)} weekly dl, ≥ ${CONFIDENCE.proven.minAgeMonths}mo old`],
      ['emerging', `≥ ${formatNumber(CONFIDENCE.emerging.minWeeklyDownloads)} weekly dl OR ≥ ${CONFIDENCE.emerging.strongGrowth * 100}% 90d growth`],
      ['promising', `≥ ${CONFIDENCE.promising.minQuality} quality score (adoption-independent)`],
    ]),
  );
  console.log(dim(`\nSource: ${active ? `${active.source} (${active.path})` : 'defaults (no user overrides)'}`));
}

export interface EditWeightsOpts {
  set?: string[];
  reset?: boolean;
  explain?: string;
  project?: boolean;
  json?: boolean;
}

/** `lurq edit-weights` — override / reset / explain the model (no DB needed).
 *  A weight change alters ranking at read time, so invalidate the response cache
 *  (no-op without REDIS_URL) when run where the index is served. */
export async function runEditWeights(opts: EditWeightsOpts): Promise<void> {
  const { invalidateCache } = await import('../core/cache');
  if (opts.reset) {
    const removed = resetWeights();
    console.log(removed.length ? `Removed overrides:\n  ${removed.join('\n  ')}` : 'No overrides to remove; already on defaults.');
    if (removed.length) await invalidateCache();
    return;
  }

  if (opts.explain) {
    const key = opts.explain;
    const text = WEIGHT_EXPLANATIONS[key];
    if (!text) {
      throw new Error(`No explanation for "${key}". Known: ${Object.keys(WEIGHT_EXPLANATIONS).join(', ')}.`);
    }
    console.log(`${bold(key)} — ${text}`);
    return;
  }

  if (opts.set && opts.set.length > 0) {
    const next = applyOverrides(loadWeights(), opts.set);
    const { weights, normalized } = validateWeights(next);
    const path = saveWeights(weights, opts.project ? 'project' : 'user');
    await invalidateCache();
    console.log(`Saved overrides to ${path}`);
    if (normalized) {
      console.log(
        yellow('Health weights did not sum to 1.0 — renormalized to: ') +
          `maint ${weights.health.maintenance.toFixed(3)}, adopt ${weights.health.adoption.toFixed(3)}, rel ${weights.health.reliability.toFixed(3)}, eff ${weights.health.efficiency.toFixed(3)}`,
      );
    }
    console.log(dim('\nRun `lurq rescore` to apply the new health weights to the stored index.'));
    return;
  }

  // No action flags → behave like `lurq weights`.
  console.log(dim(`No changes. Settable keys: ${settableKeys().join(', ')}.\n`));
  runWeights(opts);
}

export interface PlanCliOpts {
  optimize?: string;
  json?: boolean;
  html?: string;
  open?: boolean;
}

export async function runPlan(file: string, opts: PlanCliOpts): Promise<void> {
  const { readFileSync } = await import('node:fs');
  let document: string;
  try {
    document = readFileSync(file, 'utf8');
  } catch {
    throw new Error(`Could not read "${file}".`);
  }
  if (opts.optimize && opts.optimize !== 'speed' && opts.optimize !== 'balanced') {
    throw new Error("--optimize must be 'speed' or 'balanced'.");
  }
  const args = { document, optimize: opts.optimize as 'speed' | 'balanced' | undefined };
  const res = await fromIndex('plan', args, async (db) => {
    const { handlePlan } = await import('../mcp/plan');
    return handlePlan(db, args);
  });

  if (opts.json) return console.log(JSON.stringify(res, null, 2));
  if (!('slots' in res)) {
    console.log(res.note);
    return;
  }

  // Visualization: render the roadmap to a portable HTML file and optionally open it.
  if (opts.html || opts.open) {
    const { writeFileSync } = await import('node:fs');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');
    const { renderPlanHtml } = await import('./planView');
    const out = opts.html ?? join(tmpdir(), `lurq-plan-${Date.now()}.html`);
    writeFileSync(out, renderPlanHtml(res), 'utf8');
    console.log(`Roadmap written to ${out}`);
    if (opts.open) openInBrowser(out);
  }

  console.log(
    table(
      ['Component', 'Layer', 'Recommended', 'Health', 'Confidence', 'Alternatives'],
      (res.slots ?? []).map((s) => [
        s.need.length > 32 ? s.need.slice(0, 31) + '…' : s.need,
        s.layer,
        s.recommended
          ? `${s.recommended.name}@${s.recommended.latestVersion ?? '?'}`
          : dim('—'),
        s.recommended ? String(s.recommended.healthScore) : '—',
        s.recommended ? confidenceLabel(s.recommended.confidence) : '—',
        (s.alternatives ?? []).map((a) => a.name).join(', ') || '—',
      ]),
    ),
  );
  if ((res.unmatched ?? []).length) console.log(yellow(`\nNo match for: ${(res.unmatched ?? []).join(', ')}`));

  if (res.compatibility) {
    const c = res.compatibility;
    const col = c.overall === 'compatible' ? green : c.overall === 'conflict' ? red : dim;
    console.log('\n' + bold('Compatibility: ') + col(c.overall));
    for (const s of res.slots ?? []) {
      if (s.swappedFrom && s.recommended) {
        console.log(green(`  ✓ swapped ${s.swappedFrom} → ${s.recommended.name} for compatibility`));
      }
    }
    for (const cf of c.conflicts ?? []) console.log(red(`  ✗ ${cf.detail} (no compatible alternative)`));
    if (c.unverified?.length) console.log(dim(`  unverified: ${c.unverified.join(', ')}`));
  }

  console.log('\n' + bold('Roadmap (Mermaid):'));
  console.log(res.mermaid);
  console.log(dim(`\n${res.note}`));
  console.log(dim(`data as of ${formatDate(res.dataAsOf)}`));
}

export async function runVerify(pkg: string, opts: { json?: boolean }): Promise<void> {
  const res = await fromIndex('verify', { package: pkg }, (db) =>
    handleVerify(db, { package: pkg }),
  );

  if (opts.json) return console.log(JSON.stringify(res, null, 2));
  const riskColor = res.risk === 'high' ? red : res.risk === 'medium' ? yellow : green;
  const verdict = !res.exists
    ? red('✗ NOT FOUND on npm')
    : res.risk === 'high'
      ? red('✗ high supply-chain risk')
      : res.risk === 'medium'
        ? yellow('⚠ exists, but risky')
        : green('✓ looks safe');
  console.log(`${bold(pkg)}  ${verdict}`);
  const riskFlags = res.riskFlags ?? [];
  console.log(
    detail([
      ['version', res.latestVersion ?? '—'],
      ['weekly dl', formatNumber(res.weeklyDownloads)],
      ['confidence', res.confidence ? confidenceLabel(res.confidence) : '—'],
      ['advisories', String(res.advisoryCount ?? 0)],
      ['risk', riskColor(res.risk)],
      ['risk flags', riskFlags.length ? yellow(riskFlags.join(', ')) : 'none'],
    ]),
  );
}

/** The stored version timeline. Reads the table directly: there is no MCP tool
 *  behind it, so unlike its neighbours this one is local-index only. */
export async function runVersions(
  pkg: string,
  opts: { json?: boolean; limit?: string },
): Promise<void> {
  const limit = opts.limit ? Math.max(1, parseInt(opts.limit, 10) || 30) : 30;
  loadEnv();
  if (!process.env.DATABASE_URL) {
    throw new Error(
      '`lurq versions` reads a local index and needs DATABASE_URL. ' +
        'On the hosted service, `lurq usage <pkg> --known <v>` gives the API delta between two versions.',
    );
  }
  await withDb(async (db) => {
    const versions = await getPackageVersions(db, pkg, limit);
    if (opts.json) return console.log(JSON.stringify(versions, null, 2));
    if (versions.length === 0) {
      console.log(`No stored versions for ${bold(pkg)}. Run \`lurq sync --package ${pkg}\` first.`);
      return;
    }
    console.log(bold(pkg));
    console.log(
      table(
        ['Version', 'Published'],
        versions.map((v) => [
          v.version,
          v.publishedAt ? v.publishedAt.toISOString().slice(0, 10) : '—',
        ]),
      ),
    );
  });
}

/** Long-running: follow the npm changes feed until interrupted (Ctrl-C). */
export async function runWatch(): Promise<void> {
  const { watchNpmChanges } = await import('../pipeline/watch');
  await withDb(async (db) => {
    const controller = new AbortController();
    const stop = () => controller.abort();
    process.once('SIGINT', stop);
    process.once('SIGTERM', stop);
    console.log(dim('watching npm for releases of tracked packages — Ctrl-C to stop'));
    try {
      await watchNpmChanges(db, { signal: controller.signal });
    } finally {
      process.off('SIGINT', stop);
      process.off('SIGTERM', stop);
    }
  });
}

/** Operator-side: install + smoke-load a package in the sandbox to verify it works. */
export async function runSandbox(
  pkg: string,
  version: string | undefined,
  opts: { esm?: boolean; allowScripts?: boolean; json?: boolean },
): Promise<void> {
  if (opts.allowScripts) {
    console.error(
      yellow('warning: running install scripts and loading the package locally without isolation'),
    );
  }
  const { verifyPackageInSandbox } = await import('../pipeline/sandbox');
  await withDb(async (db) => {
    const result = await verifyPackageInSandbox(db, pkg, version ?? null, {
      target: { node: '20', moduleSystem: opts.esm ? 'esm' : 'cjs' },
      allowScripts: opts.allowScripts,
    });
    if (opts.json) return console.log(JSON.stringify(result, null, 2));
    const ok = result.installed && result.imported !== false;
    const label = version ? `${pkg}@${version}` : pkg;
    const verdict = ok ? green('✓ installs and loads') : red('✗ failed');
    console.log(`${bold(label)}  ${verdict}  ${dim(`(${result.durationMs}ms · ${result.driver})`)}`);
    console.log(
      detail([
        ['installed', result.installed ? 'yes' : 'no'],
        ['loaded', result.imported === null ? '—' : result.imported ? 'yes' : 'no'],
        ['module', result.moduleSystem],
        ['scripts', result.ranScripts ? 'ran' : 'skipped'],
        ['error', result.error ?? 'none'],
      ]),
    );
  });
}

/** Version-exact API surface + drift from a known version (§4D). */
export async function runUsage(
  pkg: string,
  opts: { version?: string; known?: string; json?: boolean },
): Promise<void> {
  const args = { package: pkg, version: opts.version, knownVersion: opts.known };
  const res = await fromIndex('usage', args, async (db) => {
    const { handleUsage } = await import('../mcp/handlers');
    return handleUsage(db, args);
  });

  if (opts.json) return console.log(JSON.stringify(res, null, 2));

  console.log(`${bold(res.package)}${res.version ? `@${res.version}` : ''}`);
  if (res.engines) {
    const reqs = Object.entries(res.engines).map(([k, v]) => `${k} ${v}`).join(', ');
    if (reqs) console.log(dim(`requires: ${reqs}`));
  }
  // A version npm never published is an error in the request, not a gap in our
  // index, so it gets the red treatment rather than the dim "no data" one.
  if (res.unpublishedVersion) return console.log(red(res.note ?? 'that version does not exist'));
  if (!res.available) return console.log(dim(res.note ?? 'no API surface available'));

  console.log(
    table(
      ['Export', 'Kind', 'Signature'],
      (res.surface ?? []).map((s) => [s.name, s.kind, s.signature ?? '']),
    ),
  );

  if (res.delta) {
    const d = res.delta;
    const removed = d.removed ?? [];
    const added = d.added ?? [];
    const renamed = d.renamed ?? [];
    const changed = d.changed ?? [];
    console.log(bold(`\nΔ from ${res.package}@${d.fromVersion}:`));
    for (const s of removed) console.log(red(`  - ${s.name}`));
    for (const s of added) console.log(green(`  + ${s.name}`));
    for (const r of renamed) console.log(yellow(`  ~ ${r.from.name} → ${r.to.name}`));
    for (const c of changed) console.log(yellow(`  ! ${c.name}: ${c.before ?? '?'} → ${c.after ?? '?'}`));
    if (!removed.length && !added.length && !renamed.length && !changed.length) {
      console.log(dim('  no API changes'));
    }
  } else if (res.deltaNote) {
    console.log(yellow(`\n${res.deltaNote}`));
  }
}

/** Operator: batched backfill of compat edges over the top-N packages (§4C).
 *  `resolve` uses the cheap resolve-only tier (no VM); otherwise the sandbox. */
export async function runCompatBackfill(opts: {
  topN?: number;
  batchSize?: number;
  resolve?: boolean;
}): Promise<void> {
  await withDb(async (db) => {
    const compat = await import('../pipeline/compat');
    if (opts.resolve) {
      console.error(yellow('resolve-only backfill (npm resolution, no install/VM)'));
      const res = await compat.resolveBackfill(db, opts);
      console.log(
        `${green('resolve backfill done')}: ${res.verified} edges across ${res.batches} runs, ${res.skipped} batches skipped`,
      );
      return;
    }
    console.error(
      yellow('co-installing top packages in the sandbox (loads package code locally without isolation unless E2B_API_KEY is set)'),
    );
    const res = await compat.backfillVerify(db, opts);
    console.log(
      `${green('backfill done')}: ${res.verified} edges across ${res.batches} runs, ${res.skipped} batches skipped`,
    );
  });
}

/**
 * `--pin next=15.5.4` → `{ next: '15.5.4' }`.
 *
 * Exact versions only, and that restriction is load-bearing rather than lazy.
 * `fetchNpmCompatAtVersion` resolves a pin by exact key against the packument
 * and falls back to `latest` when the key is absent (see
 * ingestion/sources/npmRegistry.ts) — so `--pin next=15` would quietly check
 * next@16 and report it as the pinned answer. Refusing a range here is the
 * difference between "no result" and "a confident wrong result".
 */
function parsePins(pins: string[] | undefined): Record<string, string> | undefined {
  if (!pins?.length) return undefined;
  const out: Record<string, string> = {};
  for (const raw of pins) {
    const at = raw.indexOf('=');
    const name = at === -1 ? '' : raw.slice(0, at).trim();
    const version = at === -1 ? '' : raw.slice(at + 1).trim();
    if (!name || !version) throw new Error(`--pin expects name=version, got "${raw}"`);
    if (!semver.valid(version)) {
      throw new Error(
        `--pin needs an exact published version, got "${name}=${version}". ` +
          `A range resolves to latest instead of erroring, which would report the wrong version as pinned.`,
      );
    }
    out[name] = version;
  }
  return out;
}

/** Read pairwise package compatibility (peer/engine constraints + recorded evidence). */
export async function runCompat(
  pkgs: string[],
  opts: { run?: boolean; json?: boolean; pin?: string[] },
): Promise<void> {
  const versions = parsePins(opts.pin);
  const args = { packages: pkgs, versions };
  const read = async (db: ReturnType<typeof createDb>['db']) => {
    const { handleCompat } = await import('../mcp/handlers');
    return handleCompat(db, args);
  };
  // `compat-run` (operator plane) co-installs in the sandbox and records the
  // resulting edges before reading them back, so it always needs the local
  // database. Only the plain read can be served by the hosted index.
  const res = opts.run
    ? await withDb(async (db) => {
        console.error(
          yellow('co-installing in the sandbox (loads package code locally without isolation)'),
        );
        const { verifyCompatibility } = await import('../pipeline/compat');
        await verifyCompatibility(db, pkgs);
        return read(db);
      })
    : await fromIndex('compat', args, read);

  const conflicts = res.conflicts ?? [];
  const unverified = res.unverified ?? [];
  if (opts.json) return console.log(JSON.stringify(res, null, 2));
  const color = res.overall === 'compatible' ? green : res.overall === 'conflict' ? red : dim;
  console.log(`${bold((res.packages ?? pkgs).join(' + '))}  ${color(res.overall)}`);
  if (conflicts.length) {
    console.log(
      table(
        ['Source', 'Detail'],
        conflicts.map((c) => [c.source, c.detail]),
      ),
    );
  } else if (res.overall === 'compatible') {
    console.log(dim('no peer-dependency or engine conflicts across the set'));
  }
  if (unverified.length) {
    console.log(dim(`\nunverified (no metadata): ${unverified.join(', ')}`));
  }
  // Evidence strength (§4B): show co-install witnesses behind each pair.
  //
  // A pair can be both: tier-1 says the declared peer range is violated, and a
  // co-resolution witness says something out there installed them together
  // anyway. The declared constraint wins, which is the whole point of tier 1,
  // but printing a bare "observed, 1 witness" row directly under a red
  // `conflict` reads as the tool contradicting itself. Say which one lost.
  const conflicted = new Set(
    conflicts.flatMap((c) =>
      c.packages.length >= 2 ? [[...c.packages].sort().join(' ')] : [],
    ),
  );
  const isOverruled = (e: { packages: [string, string] }) =>
    conflicted.has([...e.packages].sort().join(' '));
  const compatEvidence = (res.evidence ?? []).filter((e) => e.status === 'compatible');
  if (compatEvidence.length) {
    console.log(
      table(
        ['Pair', 'Evidence', 'Witnesses'],
        compatEvidence.map((e) => [
          `${e.packages[0]} + ${e.packages[1]}`,
          isOverruled(e) ? `${e.provenance} (overruled)` : e.provenance,
          e.provenance === 'observed' ? String(e.witnessCount) : '—',
        ]),
      ),
    );
    if (compatEvidence.some(isOverruled)) {
      console.log(
        dim('overruled: a declared peer/engine constraint above beats the co-resolution witness'),
      );
    }
  }
}
