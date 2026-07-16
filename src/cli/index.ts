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
    .command('usage')
    .argument('<package>', 'npm package name')
    .description("version-exact API surface (exported symbols/signatures) + drift from a known version")
    .option('--version <v>', 'target version (defaults to latest)')
    .option('--known <v>', 'a version you know; shows the API delta to the target')
    .option('--json', 'output JSON')
    .action(async (pkg: string, opts: { version?: string; known?: string; json?: boolean }) => {
      const { runUsage } = await import('./commands');
      await runUsage(pkg, opts);
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
    .command('compat')
    .argument('<packages...>', 'npm package names to check together')
    .description('check whether a set of packages forms a coherent stack (peer/engine + recorded evidence)')
    .option('--json', 'output JSON')
    .action(async (pkgs: string[], opts: { json?: boolean }) => {
      const { runCompat } = await import('./commands');
      await runCompat(pkgs, opts);
    });

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

  return program;
}
