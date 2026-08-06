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
    .description('extract a package tier-A runtime surface (v1 §6.2); --store persists it')
    .option('--store', 'persist to the graph (requires DATABASE_URL)')
    .option('--json', 'output the full surface as JSON')
    .action(async (dir: string, opts: { store?: boolean; json?: boolean }) => {
      const { extractSurface } = await import('../surface/extract');
      const { runtimeSymbols } = await import('../surface/types');
      const surface = extractSurface(dir);
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
