/**
 * Operator-plane CLI commands (§4E). These build and maintain the proprietary
 * dataset — ingestion, discovery, mining, sandbox verification, key issuance,
 * schema management. They all require `DATABASE_URL` (and often heavy deps like
 * e2b) the public never has, so they're registered ONLY on the operator bin
 * (`src/bin/operator.ts`), never on the published read-only `lurq` CLI.
 *
 * Shared logic stays in `src/` — only the entry + publish manifest differ.
 */
import type { Command } from 'commander';

export function registerOperatorCommands(program: Command): void {
  program
    .command('sync')
    .description('run ingestion: refresh scores for the seed list (or one package)')
    .option('--full', 'force a full re-sync, ignoring cache TTLs')
    .option('--package <name>', 'sync a single package by name')
    .option('--json', 'output the run summary as JSON')
    .action(async (opts: { full?: boolean; package?: string; json?: boolean }) => {
      const { runSync } = await import('../pipeline/index');
      const summary = await runSync({ full: opts.full, packageName: opts.package });
      if (opts.json) console.log(JSON.stringify(summary, null, 2));
      if (summary.status === 'failed') process.exitCode = 1;
    });

  program
    .command('discover')
    .description('proactively crawl for new packages and queue/gate them (§2B)')
    .option('--cap <n>', 'max candidates to fully ingest this run', (v) => parseInt(v, 10))
    .option('--dry-run', 'discover, queue, and gate, but do not ingest survivors')
    .option('--json', 'output the discovery summary as JSON')
    .action(async (opts: { cap?: number; dryRun?: boolean; json?: boolean }) => {
      const { requireConfig } = await import('../core/config');
      requireConfig(['DATABASE_URL']);
      const { runDiscovery } = await import('../pipeline/index');
      const summary = await runDiscovery({ perRunCap: opts.cap, dryRun: opts.dryRun });
      if (opts.json) console.log(JSON.stringify(summary, null, 2));
    });

  program
    .command('surface')
    .argument('<dir>', 'installed package directory (e.g. node_modules/express)')
    .description('extract a package surface (v1 §6.2); --tier c reads .d.ts, --store persists')
    .option('--store', 'persist to the graph (requires DATABASE_URL)')
    .option('--tier <a|c>', "extraction tier: 'a' = shipped JS (default), 'c' = .d.ts")
    .option('--json', 'output the full surface as JSON')
    .action(async (dir: string, opts: { store?: boolean; tier?: string; json?: boolean }) => {
      const { extractSurface } = await import('../surface/extract');
      const { extractTypeSurface } = await import('../surface/dts');
      const { runtimeSymbols } = await import('../surface/types');
      const tierC = (opts.tier ?? 'a').toLowerCase() === 'c';
      const surface = tierC ? extractTypeSurface(dir) : extractSurface(dir);
      if (opts.json) {
        console.log(JSON.stringify(surface, null, 2));
      } else {
        const rt = runtimeSymbols(surface);
        console.log(
          `${surface.package}@${surface.version ?? '?'} · entry ${surface.entry ?? '<none>'} · ${surface.filesWalked} file(s)`,
        );
        console.log(
          `  ${rt.length} runtime symbol(s), ${surface.symbols.length - rt.length} excluded (type-only or external)`,
        );
        if (surface.externalReExports.length) {
          console.log(`  external re-exports: ${surface.externalReExports.join(', ')}`);
        }
        if (tierC) {
          const dep = surface.symbols.filter((x) => x.deprecated);
          console.log(`  tier C · ${surface.symbols.length} declared symbol(s), ${dep.length} @deprecated`);
          if (dep.length) console.log(`  deprecated: ${dep.map((x) => x.path).join(', ')}`);
          console.log('  NOTE: type-level only, never evidence of runtime existence');
        }
        if (surface.undeclaredReason) console.log(`  UNDECLARED: ${surface.undeclaredReason}`);
      }
      if (opts.store) {
        const { requireConfig } = await import('../core/config');
        requireConfig(['DATABASE_URL']);
        const { createDb } = await import('../db/client');
        const { storeSurface } = await import('../db/surface');
        const { db, close } = createDb();
        try {
          const res = await storeSurface(db, surface, { extractorVersion: '1' });
          console.log(`  stored: ${res.symbolsWritten} symbol(s) · verdict ${res.verdict}`);
        } finally {
          await close();
        }
      }
    });

  program
    .command('replay')
    .argument('<dirs...>', 'repository checkouts to replay')
    .description('M0 human baseline, do real repos reference symbols their pinned versions lack?')
    .option('--include-dev', 'also score devDependencies')
    .option('--fetch-missing', 'fetch uninstalled deps from the registry')
    .option('--json', 'output the full report as JSON')
    .action(
      async (dirs: string[], opts: { includeDev?: boolean; fetchMissing?: boolean; json?: boolean }) => {
        const { replayRepo } = await import('../benchmark/replay');
        const reports = [];
        for (const dir of dirs) {
          try {
            reports.push(await replayRepo(dir, opts));
          } catch (err) {
            console.error(`  ! ${dir}: ${String(err).slice(0, 140)}`);
          }
        }
        if (opts.json) {
          console.log(JSON.stringify(reports, null, 2));
          return;
        }
        let ref = 0;
        let miss = 0;
        for (const r of reports) {
          ref += r.totalReferenced;
          miss += r.totalMissing;
          const pct = r.missRate === null ? 'n/a' : `${(r.missRate * 100).toFixed(1)}%`;
          console.log(
            `\n${r.repo}\n  ${r.packagesReferenced} pkg(s) scored · ${r.totalReferenced} symbol(s) referenced · ${r.totalMissing} absent (${pct})`,
          );
          for (const p of r.packages.filter((x) => x.missing.length)) {
            console.log(`    MISS ${p.package}@${p.version}: ${p.missing.join(', ')}`);
          }
          if (r.skipped.length) {
            console.log(`    skipped: ${r.skipped.map((x) => x.package).join(', ')}`);
          }
        }
        const overall = ref ? ((miss / ref) * 100).toFixed(1) : 'n/a';
        console.log(`\n  HUMAN BASELINE: ${overall}% symbol miss rate (${miss}/${ref}) over ${reports.length} repo(s)`);
        console.log('  Compare against the agent arm from `miss-rate`, that comparison is M0.');
      },
    );

  program
    .command('miss-rate')
    .description('M0 controlled arm, how often does model-authored code reference absent symbols?')
    .option('--model <name>', 'model id, gpt-* | claude-* | gemini-* (default gpt-4o-mini)')
    .option('--samples <n>', 'samples per case; >1 is required for a meaningful number', (v) => parseInt(v, 10))
    .option('--suite <path>', 'case file (default tests/benchmark/miss-rate-v1.json)')
    .option('--limit <n>', 'run only the first N cases (pilot)', (v) => parseInt(v, 10))
    .option('--show-code', 'include the generated source in JSON output')
    .option('--json', 'output the full report as JSON')
    .action(
      async (opts: {
        model?: string;
        suite?: string;
        limit?: number;
        samples?: number;
        showCode?: boolean;
        json?: boolean;
      }) => {
        const { readFileSync } = await import('node:fs');
        const { runMissRate } = await import('../benchmark/missRate');
        const path = opts.suite ?? 'tests/benchmark/miss-rate-v1.json';
        const suite = JSON.parse(readFileSync(path, 'utf8')) as {
          cases: { id: string; package: string; version: string; task: string }[];
        };
        const cases = opts.limit ? suite.cases.slice(0, opts.limit) : suite.cases;
        const model = opts.model ?? 'gpt-4o-mini';

        const report = await runMissRate(cases, model, {
          keepCode: opts.showCode,
          samples: opts.samples,
        });
        if (opts.json) {
          console.log(JSON.stringify(report, null, 2));
          return;
        }
        console.log(
          `\nmodel: ${report.model} · ${report.samples} sample(s)/case · ${report.scored}/${report.cases} scored · ${report.unverifiable} unverifiable\n`,
        );
        for (const r of report.results) {
          if (r.unverifiable) {
            console.log(`  ${r.id.padEnd(20)} unverifiable: ${r.unverifiable}`);
          } else {
            const mark = r.missing.length ? 'MISS  ' : 'ok    ';
            console.log(
              `  ${mark} ${r.id.padEnd(20)} ${r.referenced.length - r.missing.length}/${r.referenced.length} exist` +
                (r.missing.length ? `  absent: ${r.missing.join(', ')}` : ''),
            );
          }
        }
        const pct = (n: number | null) => (n === null ? 'n/a' : `${(n * 100).toFixed(1)}%`);
        console.log(`\n  symbol miss rate: ${pct(report.symbolMissRate)} (${report.totalMissing}/${report.totalReferenced})`);
        console.log(`  case miss rate:   ${pct(report.caseMissRate)}, samples with >=1 absent symbol`);
        console.log(
          `  symbols/sample:   ${report.symbolsPerCase?.toFixed(1) ?? 'n/a'} referenced (the exposure N)`,
        );
        console.log(
          `  projected break:  ${pct(report.projectedBreakRate)} = 1-(1-p)^N at this p and N`,
        );
        console.log('\n  NOTE: no human baseline arm, so this measures magnitude and cannot');
        console.log('        pass or fail M0 on its own (§12 kill condition).');
      },
    );

  // `check-upgrade` used to live here. It is now a public command
  // (src/cli/index.ts) because CI runs it through `npx lurqrun`, and the
  // operator plane registers onto the same program — a copy here would collide
  // outright, and two copies would eventually disagree about what "safe" means.

  program
    .command('scan-references')
    .argument('<dir>', 'project directory to scan')
    .description('list the symbols this codebase uses from each dependency')
    .option('--package <name>', 'only this package')
    .action(async (dir: string, opts: { package?: string }) => {
      const { scanReferences } = await import('../surface/references');
      const refs = scanReferences(dir).filter((r) => !opts.package || r.package === opts.package);
      for (const r of refs) {
        console.log(`${r.package} (${r.symbols.size} symbol(s))`);
        for (const [sym, uses] of r.symbols) {
          console.log(`  ${sym}  ${uses.slice(0, 3).map((u) => `${u.file}:${u.line}`).join(', ')}`);
        }
      }
    });

  program
    .command('surface-validate')
    .description('run the §7 validation gates against a sample of packages')
    .option('--packages <list>', 'comma-separated package names (default: a seed sample)')
    .option('--limit <n>', 'sample size when drawing from the seed list', (v) => parseInt(v, 10))
    .option('--json', 'output the full report as JSON')
    .action(async (opts: { packages?: string; limit?: number; json?: boolean }) => {
      const { getSandbox } = await import('../sandbox');
      const { runValidation } = await import('../surface/validate');
      const sandbox = await getSandbox();
      if (sandbox.name === 'local') {
        console.warn(
          '[warn] using the LOCAL sandbox: tier B imports execute package code on this machine.\n' +
            '       Set E2B_API_KEY to validate untrusted packages under VM isolation.',
        );
      }

      let names: string[];
      if (opts.packages) {
        names = opts.packages.split(',').map((s) => s.trim()).filter(Boolean);
      } else {
        // §6.4.7: never sample from search relevance — it is name-weighted and
        // biases toward packages matching the seed terms. The curated seed list
        // is a fixed frame; it skews popular, which biases coverage UP, and that
        // must be stated alongside any number drawn from it.
        // Package-relative (loadSeedFile → seedJsonPath), never cwd-relative:
        // the operator runs from deploy dirs, not just the repo root.
        const { loadSeedFile } = await import('../db/seed');
        names = loadSeedFile()
          .map((e) => e.name)
          .slice(0, opts.limit ?? 20);
      }

      const report = await runValidation(names.map((name) => ({ name })), { sandbox });
      if (opts.json) {
        console.log(JSON.stringify(report, null, 2));
        return;
      }
      console.log(
        `\nsampled ${report.sampled} · covered ${report.covered} · undeclared ${report.undeclared} · unverifiable ${report.unverifiable}`,
      );
      console.log(`symbols: ${report.totalConfirmed}/${report.totalClaimed} confirmed at tier B\n`);
      for (const g of report.gates) {
        const mark = g.pass === null ? '-' : g.pass ? 'PASS' : 'FAIL';
        console.log(`  [${mark}] ${g.name}: ${g.actual} (target ${g.target})`);
      }
      const bad = report.perPackage.filter((p) => p.precision !== null && p.precision < 1);
      if (bad.length) {
        console.log('\n  packages below 100% precision:');
        for (const b of bad) {
          console.log(`    ${b.package}@${b.version}: ${b.confirmed}/${b.claimed}`);
        }
      }
      const unv = report.perPackage.filter((p) => p.unverifiable);
      if (unv.length) {
        console.log('\n  unverifiable (excluded from the gate, NOT counted as failures):');
        for (const u of unv.slice(0, 10)) console.log(`    ${u.package}: ${u.unverifiable}`);
      }
    });

  program
    .command('surface-drain')
    .description('service the demand-driven surface-extraction queue (§6.1)')
    .option('--limit <n>', 'specs to drain this run (default 10)', (v) => parseInt(v, 10))
    .option('--package <name>', 'extract one package directly, bypassing the queue')
    .option('--package-version <v>', 'version for --package (default latest)')
    .action(async (opts: { limit?: number; package?: string; packageVersion?: string }) => {
      const { requireConfig } = await import('../core/config');
      requireConfig(['DATABASE_URL']);
      const { createDb } = await import('../db/client');
      const { drainSurfaceQueue, extractAndStore } = await import('../pipeline/surface');
      const { db, close } = createDb();
      try {
        if (opts.package) {
          const outcome = await extractAndStore(db, opts.package, opts.packageVersion ?? null);
          console.log(`${opts.package}@${opts.packageVersion ?? 'latest'}: ${outcome}`);
        } else {
          const s = await drainSurfaceQueue(db, { limit: opts.limit });
          console.log(
            `drained ${s.drained} · stored ${s.stored} · cached ${s.cached} · undeclared ${s.undeclared} · failed ${s.failed}`,
          );
        }
      } finally {
        await close();
      }
    });

  program
    .command('surface-diff')
    .argument('<dirA>', 'package directory at the FROM version')
    .argument('<dirB>', 'package directory at the TO version')
    .description('diff two extracted surfaces (v1 §8.1 diff_surface)')
    .option('--json', 'output the diff as JSON')
    .action(async (dirA: string, dirB: string, opts: { json?: boolean }) => {
      const { extractSurface } = await import('../surface/extract');
      const { diffSurfaces } = await import('../surface/diff');
      const diff = diffSurfaces(extractSurface(dirA), extractSurface(dirB));
      if (opts.json) {
        console.log(JSON.stringify(diff, null, 2));
        return;
      }
      if (diff.inconclusive) {
        console.log(`inconclusive: ${diff.inconclusive}`);
        process.exitCode = 1;
        return;
      }
      console.log(`${diff.package} ${diff.fromVersion ?? '?'} → ${diff.toVersion ?? '?'} (tier ${diff.tier})`);
      const line = (label: string, items: string[]) => {
        if (items.length) console.log(`  ${label}: ${items.join(', ')}`);
      };
      line(`removed (${diff.removed.length})`, diff.removed.map((s) => s.path));
      line(`arity changed`, diff.arityChanged.map((a) => `${a.path} ${a.from}→${a.to}`));
      line(`type-only removed (breaks tsc, not node)`, diff.typeOnlyRemoved.map((s) => s.path));
      line(`added (${diff.added.length})`, diff.added.map((s) => s.path));
      if (!diff.removed.length && !diff.arityChanged.length) console.log('  no runtime breakage');
    });

  program
    .command('oracle')
    .argument('<kind>', 'node kind to verify (mcp_server)')
    .argument('<name>', 'entity name, e.g. an npm package that ships an MCP server')
    .description('run the oracle for a node kind and record observations (v2 graph)')
    .option('--version <v>', 'pin the entity version')
    .option('--namespace <ns>', 'registry/authority (default npm)')
    .option('--json', 'output the run result as JSON')
    .action(
      async (
        kind: string,
        name: string,
        opts: { version?: string; namespace?: string; json?: boolean },
      ) => {
        const { requireConfig } = await import('../core/config');
        requireConfig(['DATABASE_URL']);
        const { createDb } = await import('../db/client');
        const { runOracle, ORACLES } = await import('../graph/run');
        const { db, close } = createDb();
        try {
          if (!(kind in ORACLES)) {
            throw new Error(
              `No oracle for '${kind}'. Registered: ${Object.keys(ORACLES).join(', ')}`,
            );
          }
          const result = await runOracle(db, {
            kind: kind as keyof typeof ORACLES,
            namespace: opts.namespace ?? 'npm',
            name,
            version: opts.version ?? null,
          });
          if (opts.json) {
            console.log(JSON.stringify(result, null, 2));
          } else {
            console.log(
              `${name}: ${result.verdicts.join(', ')} · ${result.discovered} tool(s) · ${result.costMillis}ms`,
            );
          }
        } finally {
          await close();
        }
      },
    );

  program
    .command('worker')
    .description('run the autonomous discovery loop (discover → ingest → mine → extract → rescore); Ctrl-C stops it cleanly (§4G)')
    .option('--interval <sec>', 'seconds between cycles (default 900)', (v) => parseInt(v, 10))
    .option('--cap <n>', 'candidates ingested per cycle', (v) => parseInt(v, 10))
    .option('--extract <n>', 'API surfaces extracted per cycle', (v) => parseInt(v, 10))
    .option('--compat-verify <n>', 'demand-driven compat-verify sets drained per cycle', (v) => parseInt(v, 10))
    .option('--surface <n>', 'demand-driven surface extractions drained per cycle', (v) => parseInt(v, 10))
    .option('--once', 'run exactly one cycle and exit')
    .action(
      async (opts: {
        interval?: number;
        cap?: number;
        extract?: number;
        compatVerify?: number;
        surface?: number;
        once?: boolean;
      }) => {
        const { requireConfig } = await import('../core/config');
        requireConfig(['DATABASE_URL']);
        const { runWorker } = await import('../pipeline/index');
        await runWorker({
          intervalSec: opts.interval,
          perRunCap: opts.cap,
          extractPerCycle: opts.extract,
          compatVerifyPerCycle: opts.compatVerify,
          surfacePerCycle: opts.surface,
          once: opts.once,
        });
      },
    );

  program
    .command('rescore')
    .description('re-derive health scores from cached breakdowns using current weights (no re-ingest)')
    .option('--json', 'output the rescore summary as JSON')
    .action(async (opts: { json?: boolean }) => {
      const { requireConfig } = await import('../core/config');
      requireConfig(['DATABASE_URL']);
      const { runRescore } = await import('../pipeline/index');
      const summary = await runRescore();
      if (opts.json) console.log(JSON.stringify(summary, null, 2));
    });

  program
    .command('repos-scan')
    .description('re-read every connected repo\'s manifests and recompute its drift')
    .option('--json', 'output the per-repo scan results as JSON')
    .action(async (opts: { json?: boolean }) => {
      const { requireConfig } = await import('../core/config');
      requireConfig(['DATABASE_URL']);
      const { githubAppCredentials } = await import('../github/app');
      if (!githubAppCredentials()) {
        // Not an error: most deployments have no GitHub App, and the daily cron
        // chains this after `sync`. Exiting non-zero would fail the whole run.
        console.log('GitHub App not configured, nothing to scan.');
        return;
      }
      const { createDb } = await import('../db/client');
      const { scanAllRepos } = await import('../pipeline/repoScan');
      const { db, close } = createDb();
      try {
        const results = await scanAllRepos(db);
        // A scan queues every dependency the index had never seen, and those
        // background syncs run on THIS pool. Closing it the moment the scan
        // returns would fail every one of them, so the cron waits for the
        // backlog it created before shutting down.
        const { drainIngestQueue } = await import('../pipeline/ingestQueue');
        const stranded = await drainIngestQueue();
        if (opts.json) console.log(JSON.stringify(results, null, 2));
        else {
          const failed = results.filter((r) => !r.ok).length;
          const left = stranded > 0 ? `, ${stranded} left to ingest next run` : '';
          console.log(`scanned ${results.length} repo(s), ${failed} failed${left}`);
        }
      } finally {
        await close();
      }
    });

  program
    .command('watch')
    .description('follow the npm changes feed, re-syncing tracked packages on new releases')
    .action(async () => {
      const { runWatch } = await import('./commands');
      await runWatch();
    });

  program
    .command('sandbox')
    .argument('<package>', 'npm package name')
    .argument('[version]', 'specific version (default: latest)')
    .description('install + smoke-load a package in a sandbox to verify it actually works')
    .option('--esm', 'load via ESM import instead of CJS require')
    .option('--allow-scripts', 'run install scripts (UNSAFE without VM isolation)')
    .option('--json', 'output JSON')
    .action(
      async (
        pkg: string,
        version: string | undefined,
        opts: { esm?: boolean; allowScripts?: boolean; json?: boolean },
      ) => {
        const { runSandbox } = await import('./commands');
        await runSandbox(pkg, version, opts);
      },
    );

  program
    .command('compat-run')
    .argument('<packages...>', 'npm package names to co-install and verify')
    .description('co-install a set in the sandbox (UNSAFE without VM isolation), record edges, then read compatibility')
    .option('--json', 'output JSON')
    .action(async (pkgs: string[], opts: { json?: boolean }) => {
      const { runCompat } = await import('./commands');
      await runCompat(pkgs, { run: true, json: opts.json });
    });

  program
    .command('retrieval-eval')
    .description('measure whether recommend can find a package from a description of what it does')
    .option('--per-category <n>', 'cases per category (default 17)', (v) => parseInt(v, 10))
    .option('--limit <n>', 'candidates retrieved per query (default 25)', (v) => parseInt(v, 10))
    .option('--json <path>', 'write per-case results for a later paired comparison')
    .option('--compare <path>', 'paired McNemar test against a previous --json run')
    .action(async (opts: { perCategory?: number; limit?: number; json?: string; compare?: string }) => {
      const { requireConfig } = await import('../core/config');
      requireConfig(['DATABASE_URL']);
      const { createDb } = await import('../db/client');
      const { buildCases, runCases, computeMetrics, pairedPValue } = await import('../benchmark/retrieval');
      const { db, close } = createDb();
      try {
        const cases = await buildCases(db, { perCategory: opts.perCategory });
        console.log(`built ${cases.length} cases across ${new Set(cases.map((c) => c.category)).size} categories`);
        const results = await runCases(db, cases, {
          limit: opts.limit,
          onProgress: (n) => { if (n % 25 === 0) process.stderr.write(`  ${n}/${cases.length}\r`); },
        });
        const m = computeMetrics(results);
        console.log(
          `\ncases ${m.cases} · recall@1 ${(100 * m.recallAt1).toFixed(1)}% · recall@5 ${(100 * m.recallAt5).toFixed(1)}%` +
            ` · recall@25 ${(100 * m.recallAt25).toFixed(1)}% · MRR ${m.mrr.toFixed(3)}`,
        );
        const worst = Object.entries(m.byCategory).sort((a, b) => a[1].recallAt25 - b[1].recallAt25).slice(0, 6);
        console.log('\nweakest categories (recall@25):');
        for (const [cat, b] of worst) console.log(`  ${cat.padEnd(24)} ${(100 * b.recallAt25).toFixed(0)}%  (${b.cases} cases)`);
        const { writeFileSync, readFileSync } = await import('node:fs');
        if (opts.json) { writeFileSync(opts.json, JSON.stringify(results, null, 2)); console.log(`\nwrote ${opts.json}`); }
        if (opts.compare) {
          const before = JSON.parse(readFileSync(opts.compare, 'utf8'));
          const p = pairedPValue(before, results);
          console.log(`\npaired vs ${opts.compare}: McNemar exact p = ${p.toFixed(4)}${p < 0.05 ? ' (significant)' : ' (NOT significant)'}`);
        }
      } finally {
        await close();
      }
    });

  program
    .command('dependents-backfill')
    .description('fill direct/indirect dependent counts from deps.dev (resumable)')
    .option('--limit <n>', 'rows to attempt this run (default 2000)', (v) => parseInt(v, 10))
    .option('--stratify', 'take the top rows per category instead of globally')
    .option('--per-category <n>', 'rows per category when stratifying (default 90)', (v) => parseInt(v, 10))
    .option('--concurrency <n>', 'parallel deps.dev requests (default 6)', (v) => parseInt(v, 10))
    .action(async (opts: { limit?: number; stratify?: boolean; perCategory?: number; concurrency?: number }) => {
      const { requireConfig } = await import('../core/config');
      requireConfig(['DATABASE_URL']);
      const { createDb } = await import('../db/client');
      const { backfillDependents } = await import('../pipeline/dependents');
      const { db, close } = createDb();
      try {
        let last = 0;
        const s = await backfillDependents(db, {
          limit: opts.limit,
          stratify: opts.stratify,
          perCategory: opts.perCategory,
          concurrency: opts.concurrency,
          onProgress: (done, total) => {
            if (done - last >= 100 || done === total) {
              last = done;
              process.stderr.write(`  ${done}/${total}\r`);
            }
          },
        });
        console.log(
          `\nattempted ${s.attempted} · filled ${s.filled} · no-data ${s.missing} · skipped ${s.skipped}`,
        );
      } finally {
        await close();
      }
    });

  program
    .command('compat-backfill')
    .description('backfill compat edges over the top-N popular packages in batches (§4C)')
    .option('--top <n>', 'how many popular packages to cover', (v) => parseInt(v, 10))
    .option('--batch <k>', 'packages settled per run', (v) => parseInt(v, 10))
    .option('--resolve', 'use the cheap resolve-only tier (npm resolution, no install/VM)')
    .action(async (opts: { top?: number; batch?: number; resolve?: boolean }) => {
      const { runCompatBackfill } = await import('./commands');
      await runCompatBackfill({ topN: opts.top, batchSize: opts.batch, resolve: opts.resolve });
    });

  const keys = program
    .command('keys')
    .description('manage API keys for the hosted service (needs DATABASE_URL)');
  keys
    .command('create')
    .description('create a new API key (shown once; erased from the terminal after you copy it)')
    .option('--label <label>', 'human label (owner / org / purpose)')
    .option('--tier <tier>', 'tier name', 'free')
    .option('--owner <id>', 'org/owner id to attribute this key to (e.g. a Clerk org id)')
    .option('--json', 'print the key as JSON and skip the interactive erase (for scripts)')
    .action(async (opts: { label?: string; tier?: string; owner?: string; json?: boolean }) => {
      const { runKeysCreate } = await import('./keys');
      await runKeysCreate(opts);
    });
  keys
    .command('list')
    .description('list issued API keys (hashes are never shown)')
    .option('--json', 'output as JSON')
    .action(async (opts: { json?: boolean }) => {
      const { runKeysList } = await import('./keys');
      await runKeysList(opts);
    });
  keys
    .command('rotate')
    .argument('<prefixOrId>', 'key prefix (e.g. lurq_live_ab12cd) or numeric id to replace')
    .description('issue a replacement key (same label/tier) and revoke the old one')
    .option('--json', 'print the new key as JSON and skip the interactive erase (for scripts)')
    .action(async (prefixOrId: string, opts: { json?: boolean }) => {
      const { runKeysRotate } = await import('./keys');
      await runKeysRotate(prefixOrId, opts);
    });
  keys
    .command('revoke')
    .argument('<prefixOrId>', 'key prefix (e.g. lurq_live_ab12cd) or numeric id')
    .description('revoke an API key')
    .action(async (prefixOrId: string) => {
      const { runKeysRevoke } = await import('./keys');
      await runKeysRevoke(prefixOrId);
    });

  const billing = program.command('billing').description('Stripe billing setup');
  billing
    .command('setup')
    .description('create/reuse the Stripe products, prices and webhook, then print the env vars')
    .option(
      '--webhook-url <url>',
      'where Stripe should POST events',
      'https://api.lurq.run/billing/webhook',
    )
    .action(async (opts: { webhookUrl: string }) => {
      const { provisionBilling } = await import('../billing/provision');
      const { env } = await provisionBilling(opts.webhookUrl);
      if (Object.keys(env).length === 0) {
        console.log('\nNothing new to set.');
        return;
      }
      console.log('\nSet these on the serve-http service (Railway), NOT on the web app:\n');
      for (const [k, v] of Object.entries(env)) console.log(`  ${k}=${v}`);
      console.log(
        '\nSTRIPE_SECRET_KEY and LURQ_WEB_URL go there too. The web app needs none of them.',
      );
    });
  billing
    .command('status')
    .description('report what is configured in Stripe, changing nothing')
    .action(async () => {
      const { billingStatus } = await import('../billing/provision');
      for (const line of await billingStatus()) console.log(line);
    });

  const db = program.command('db').description('database management');
  db.command('migrate')
    .description('apply database migrations and load the seed list')
    .action(async () => {
      const { runMigrate } = await import('../db/migrate');
      await runMigrate();
    });
  db.command('reset')
    .description('drop and recreate the schema (destructive)')
    .option('--yes', 'skip the confirmation prompt')
    .action(async (opts: { yes?: boolean }) => {
      if (!opts.yes) {
        console.error(
          'Refusing to reset without confirmation. Re-run with `--yes` to drop and recreate the schema.',
        );
        process.exitCode = 1;
        return;
      }
      const { runReset } = await import('../db/migrate');
      await runReset();
    });
}
