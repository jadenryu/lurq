/**
 * Human-facing CLI command implementations (§13). Each reuses the MCP handlers
 * against a DB connection, then renders a compact table/detail view — or raw
 * JSON with `--json`.
 */
import { requireConfig } from '../core/config';
import { isCategory, type Category, type Confidence } from '../core/types';
import { createDb } from '../db/client';
import { handleCompare, handleEvaluate, handleRecommend, handleVerify } from '../mcp/handlers';
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
        ['Package', 'Health', 'Confidence', 'Weekly', 'Latest', 'Category'],
        res.candidates.map((c) => [
          c.name,
          String(c.healthScore),
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
        [
          'breakdown',
          `maint ${b.maintenance} · adopt ${b.adoption} · rel ${b.reliability} · eff ${b.efficiency ?? '—'}`,
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

export async function runVerify(pkg: string, opts: { json?: boolean }): Promise<void> {
  await withDb(async (db) => {
    const res = await handleVerify(db, { package: pkg });
    if (opts.json) return console.log(JSON.stringify(res, null, 2));
    const verdict = !res.exists
      ? red('✗ NOT FOUND on npm')
      : res.deprecated || res.archived || res.advisoryCount > 0
        ? yellow('⚠ exists, but risky')
        : green('✓ looks safe');
    console.log(`${bold(pkg)}  ${verdict}`);
    console.log(
      detail([
        ['version', res.latestVersion ?? '—'],
        ['weekly dl', formatNumber(res.weeklyDownloads)],
        ['confidence', res.confidence ? confidenceLabel(res.confidence) : '—'],
        ['advisories', String(res.advisoryCount)],
        ['risk flags', res.riskFlags.length ? yellow(res.riskFlags.join(', ')) : 'none'],
      ]),
    );
  });
}
