/**
 * Human-facing CLI command implementations (§13). Each reuses the MCP handlers
 * against a DB connection, then renders a compact table/detail view — or raw
 * JSON with `--json`.
 */
import { requireConfig } from '../core/config';
import { isCategory, type Category, type Confidence } from '../core/types';
import { createDb } from '../db/client';
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

export interface RecommendCliOpts {
  category?: string;
  minConfidence?: string;
  json?: boolean;
}

export async function runRecommend(need: string, opts: RecommendCliOpts): Promise<void> {
  if (opts.category && !isCategory(opts.category)) {
    throw new Error(`Unknown category "${opts.category}".`);
  }
  await withDb(async (db) => {
    const res = await handleRecommend(db, {
      need,
      category: opts.category as Category | undefined,
      constraints: opts.minConfidence
        ? { minConfidence: opts.minConfidence as Confidence }
        : undefined,
    });
    if (opts.json) return console.log(JSON.stringify(res, null, 2));
    if (res.candidates.length === 0) {
      console.log('No matching packages found.');
      return;
    }
    console.log(
      table(
        ['Package', 'Health', 'Quality', 'Confidence', 'Weekly', 'Latest', 'Category'],
        res.candidates.map((c) => [
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
    console.log(dim(`\ndata as of ${formatDate(res.dataAsOf)}`));
  });
}

export async function runEvaluate(pkg: string, opts: { json?: boolean }): Promise<void> {
  await withDb(async (db) => {
    const res = await handleEvaluate(db, { package: pkg });
    if (opts.json) return console.log(JSON.stringify(res, null, 2));
    if ('tracked' in res) {
      console.log(res.suggestion);
      return;
    }
    console.log(bold(res.name) + (res.category ? dim(`  (${res.category})`) : ''));
    const b = res.scoreBreakdown;
    console.log(
      detail([
        ['health', `${res.healthScore}  ${confidenceLabel(res.confidence)}`],
        ['quality', res.qualityScore != null ? String(res.qualityScore) : '—'],
        [
          'breakdown',
          `maint ${b.maintenance} · adopt ${b.adoption} · rel ${b.reliability} · eff ${b.efficiency ?? '—'} · qual ${b.quality ?? '—'}`,
        ],
        ['version', res.latestVersion ?? '—'],
        ['weekly dl', `${formatNumber(res.weeklyDownloads)}  (${formatPercent(res.downloadGrowth90d)} 90d)`],
        ['scorecard', res.scorecard != null ? String(res.scorecard) : '—'],
        ['bundle', res.bundleMinGzipKb != null ? `${res.bundleMinGzipKb} KB gzip` : '—'],
        ['released', formatDate(res.lastReleaseAt)],
        ['flags', [res.deprecated && 'deprecated', res.archived && 'archived'].filter(Boolean).join(', ') || 'none'],
        ['advisories', res.advisories.length ? res.advisories.map((a) => `${a.severity}`).join(', ') : 'none'],
        ['repo', res.repoUrl ?? '—'],
      ]),
    );
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
  });
}

export async function runCompare(pkgs: string[], opts: { json?: boolean }): Promise<void> {
  await withDb(async (db) => {
    const res = await handleCompare(db, { packages: pkgs });
    if (opts.json) return console.log(JSON.stringify(res, null, 2));
    console.log(
      table(
        ['Package', 'Health', 'Confidence', 'Weekly', '90d', 'Scorecard', 'Released'],
        res.rows.map((r) => [
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
    if (res.missing?.length) console.log(dim(`\nnot found: ${res.missing.join(', ')}`));
    console.log(dim(`data as of ${formatDate(res.dataAsOf)}`));
  });
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

/** Open a file/URL in the OS default app, cross-platform, best-effort. No shell
 *  (avoids metacharacter injection); on Windows `cmd /c start "" <target>` keeps
 *  spaced paths intact because Node passes each arg separately. */
async function openInBrowser(target: string): Promise<void> {
  const { spawn } = await import('node:child_process');
  const [cmd, args]: [string, string[]] =
    process.platform === 'darwin'
      ? ['open', [target]]
      : process.platform === 'win32'
        ? ['cmd', ['/c', 'start', '', target]]
        : ['xdg-open', [target]];
  spawn(cmd, args, { stdio: 'ignore', detached: true }).unref();
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
  await withDb(async (db) => {
    const { handlePlan } = await import('../mcp/plan');
    const res = await handlePlan(db, {
      document,
      optimize: opts.optimize as 'speed' | 'balanced' | undefined,
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
      if (opts.open) await openInBrowser(out);
    }

    console.log(
      table(
        ['Component', 'Layer', 'Recommended', 'Health', 'Confidence', 'Alternatives'],
        res.slots.map((s) => [
          s.need.length > 32 ? s.need.slice(0, 31) + '…' : s.need,
          s.layer,
          s.recommended?.name ?? dim('—'),
          s.recommended ? String(s.recommended.healthScore) : '—',
          s.recommended ? confidenceLabel(s.recommended.confidence) : '—',
          s.alternatives.map((a) => a.name).join(', ') || '—',
        ]),
      ),
    );
    if (res.unmatched.length) console.log(yellow(`\nNo match for: ${res.unmatched.join(', ')}`));
    console.log('\n' + bold('Roadmap (Mermaid):'));
    console.log(res.mermaid);
    console.log(dim(`\n${res.note}`));
    console.log(dim(`data as of ${formatDate(res.dataAsOf)}`));
  });
}

export async function runVerify(pkg: string, opts: { json?: boolean }): Promise<void> {
  await withDb(async (db) => {
    const res = await handleVerify(db, { package: pkg });
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
    console.log(
      detail([
        ['version', res.latestVersion ?? '—'],
        ['weekly dl', formatNumber(res.weeklyDownloads)],
        ['confidence', res.confidence ? confidenceLabel(res.confidence) : '—'],
        ['advisories', String(res.advisoryCount)],
        ['risk', riskColor(res.risk)],
        ['risk flags', res.riskFlags.length ? yellow(res.riskFlags.join(', ')) : 'none'],
      ]),
    );
  });
}
