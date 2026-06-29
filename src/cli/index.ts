/**
 * CLI command wiring (§13). Built with commander. Each command mirrors an MCP
 * tool or an operational task. Handlers are filled in across milestones M1–M7;
 * the command/option surface here is the final, stable shape.
 *
 * Every command supports `--json` for machine-readable output.
 */
import { Command } from 'commander';
import { SERVER_NAME, VERSION } from '../core/constants';

export function buildProgram(): Command {
  const program = new Command();

  program
    .name(SERVER_NAME)
    .description(
      'lurq - a fresh, objectively-scored index of JS/TS packages for AI coding agents.',
    )
    .version(VERSION, '-v, --version', 'output the lurq version');

  program
    .command('serve')
    .description('start the MCP server over stdio (for agent integration)')
    .action(async () => {
      const { startMcpServer } = await import('../mcp/server');
      await startMcpServer();
    });

  program
    .command('serve-http')
    .description('start the hosted MCP server over HTTP with API-key auth')
    .option('--port <n>', 'port to listen on (default: $PORT or 8080)', (v) => parseInt(v, 10))
    .action(async (opts: { port?: number }) => {
      const { startHttpServer } = await import('../mcp/http');
      await startHttpServer({ port: opts.port });
    });

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
    .command('recommend')
    .argument('<need>', 'natural-language description of what you need')
    .description('recommend the best current packages for a described need')
    .option('--category <category>', 'restrict to a taxonomy category')
    .option('--min-confidence <level>', 'proven | emerging | promising | unproven')
    .option('--json', 'output JSON instead of a table')
    .action(async (need: string, opts: { category?: string; minConfidence?: string; json?: boolean }) => {
      const { runRecommend } = await import('./commands');
      await runRecommend(need, opts);
    });

  program
    .command('evaluate')
    .argument('<package>', 'npm package name')
    .description('full evidence read for one package (scores, signals, usage guide)')
    .option('--json', 'output JSON instead of a table')
    .action(async (pkg: string, opts: { json?: boolean }) => {
      const { runEvaluate } = await import('./commands');
      await runEvaluate(pkg, opts);
    });

  program
    .command('compare')
    .argument('<packages...>', '2–5 npm package names')
    .description('side-by-side comparison of packages, ranked by health')
    .option('--json', 'output JSON instead of a table')
    .action(async (pkgs: string[], opts: { json?: boolean }) => {
      const { runCompare } = await import('./commands');
      await runCompare(pkgs, opts);
    });

  program
    .command('verify')
    .argument('<package>', 'npm package name')
    .description('safety check: is this package real, healthy, and not risky?')
    .option('--json', 'output JSON instead of a table')
    .action(async (pkg: string, opts: { json?: boolean }) => {
      const { runVerify } = await import('./commands');
      await runVerify(pkg, opts);
    });

  program
    .command('versions')
    .argument('<package>', 'npm package name')
    .description('show the stored version timeline for a package')
    .option('--json', 'output JSON instead of a table')
    .option('-n, --limit <n>', 'how many versions to show (default 30)')
    .action(async (pkg: string, opts: { json?: boolean; limit?: string }) => {
      const { runVersions } = await import('./commands');
      await runVersions(pkg, opts);
    });

  program
    .command('plan')
    .argument('<file>', 'path to a markdown file describing your program')
    .description('turn a program description into an evidence-scored package plan + roadmap')
    .option('--optimize <mode>', "ranking bias: 'speed' (lightest bundle) or 'balanced'")
    .option('--html <path>', 'write the roadmap as a self-contained HTML visualization')
    .option('--open', 'render the roadmap to HTML and open it in your browser')
    .option('--json', 'output the full plan as JSON')
    .action(async (file: string, opts: { optimize?: string; json?: boolean; html?: string; open?: boolean }) => {
      const { runPlan } = await import('./commands');
      await runPlan(file, opts);
    });

  program
    .command('weights')
    .description('show and explain the scoring weight model (health, quality, composite λ)')
    .option('--json', 'output the weight model as JSON')
    .action(async (opts: { json?: boolean }) => {
      const { runWeights } = await import('./commands');
      runWeights(opts);
    });

  program
    .command('edit-weights')
    .description('override, reset, or explain the scoring weights (layered over defaults)')
    .option('--set <pair>', 'override key=value, e.g. composite.lambda=0.5 (repeatable)', (v: string, acc: string[]) => acc.concat(v), [])
    .option('--reset', 'remove all overrides and restore defaults')
    .option('--explain <component>', 'explain a component (e.g. adoption, quality, lambda)')
    .option('--project', 'write to project-local .lurq/weights.json instead of the user config')
    .action(async (opts: { set?: string[]; reset?: boolean; explain?: string; project?: boolean }) => {
      const { runEditWeights } = await import('./commands');
      await runEditWeights(opts);
    });

  program
    .command('discover')
    .description('operator-side: proactively crawl for new packages and queue/gate them (§2B)')
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
    .description(
      'operator-side: follow the npm changes feed, re-syncing tracked packages on new releases',
    )
    .action(async () => {
      const { runWatch } = await import('./commands');
      await runWatch();
    });

  program
    .command('sandbox')
    .argument('<package>', 'npm package name')
    .argument('[version]', 'specific version (default: latest)')
    .description(
      'operator-side: install + smoke-load a package in a sandbox to verify it actually works',
    )
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
    .command('install')
    .description('guided setup: connect lurq to your AI assistant(s)')
    .option('--api-key <key>', 'hosted API key (skips the prompt)')
    .option('--url <url>', 'hosted endpoint URL (defaults to the lurq service)')
    .option('--agent <agent>', 'claude-code | cursor | copilot | windsurf | codex | all')
    .option('--yes', 'non-interactive: use flags/env and detected agents without prompting')
    .action(async (opts: { apiKey?: string; url?: string; agent?: string; yes?: boolean }) => {
      const { runInstallWizard } = await import('./install');
      await runInstallWizard(opts);
    });

  program
    .command('install-skill')
    .description('register lurq as an MCP server in supported AI assistants (scriptable)')
    .option(
      '--agent <agent>',
      'claude-code | cursor | copilot | windsurf | codex | all',
      'claude-code',
    )
    .option('--api-key <key>', 'hosted API key (remote install; default mode)')
    .option('--url <url>', 'hosted endpoint URL (defaults to the lurq service)')
    .option('--local', 'self-host: write a local stdio entry using your own DATABASE_URL')
    .action(async (opts: { agent?: string; apiKey?: string; url?: string; local?: boolean }) => {
      const { runInstallSkill } = await import('./installSkill');
      await runInstallSkill(opts);
    });

  const keys = program
    .command('keys')
    .description('manage API keys for the hosted service (operator; needs DATABASE_URL)');
  keys
    .command('create')
    .description('create a new API key (shown once; erased from the terminal after you copy it)')
    .option('--label <label>', 'human label (owner / org / purpose)')
    .option('--tier <tier>', 'tier name', 'free')
    .option('--json', 'print the key as JSON and skip the interactive erase (for scripts)')
    .action(async (opts: { label?: string; tier?: string; json?: boolean }) => {
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

  return program;
}
