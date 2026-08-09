/**
 * CLI command wiring (§13). Built with commander. Each command mirrors an MCP
 * tool or an operational task. Handlers are filled in across milestones M1–M7;
 * the command/option surface here is the final, stable shape.
 *
 * Every command supports `--json` for machine-readable output.
 */
import { Command, Option } from 'commander';
import { SERVER_NAME, VERSION } from '../core/constants';
import { SUPPORTED_AGENTS } from './installSkill';

/**
 * Built from the installer's own list rather than typed out, so adding an agent
 * cannot leave `--help` advertising the old set. Safe to import eagerly:
 * installSkill pulls in node builtins only (the heavy prompt deps live in
 * ./install, which stays lazy).
 */
const AGENT_CHOICES = [...SUPPORTED_AGENTS, 'all'].join(' | ');

export function buildProgram(): Command {
  const program = new Command();

  program
    .name(SERVER_NAME)
    .description(
      'lurq - a fresh, objectively-scored index of JS/TS packages for AI coding agents.',
    )
    .version(VERSION, '-v, --version', 'output the lurq version')
    // Confine program-level flags to the slot before the subcommand name.
    // Without this, commander lets the program consume a `--version` written
    // *after* a subcommand, so `lurq usage pkg --version 24.14.0` printed the
    // lurq version and exited instead of running the command — shadowing the
    // per-command version options on `usage` and (operator plane) `oracle`.
    .enablePositionalOptions()
    .addHelpText(
      'after',
      '\nNew here? Run `lurq setup` once: it stores your API key and connects every\n' +
        'coding agent on this machine. Get a key at https://lurq.run/dashboard/keys\n',
    );

  // Bare `npx lurqrun` (or a bare `lurq`) on an unconfigured machine runs setup.
  // That is the whole one-command install story: one thing to type, and the user
  // ends up with the command on their PATH, a stored key, and every agent wired.
  // Once a key exists, a bare `lurq` means "what can this do?" instead, so it
  // prints help rather than re-running a wizard nobody asked for.
  program.action(async () => {
    const { resolveApiKey } = await import('../core/userConfig');
    if (resolveApiKey()) {
      program.outputHelp();
      return;
    }
    const { runSetup } = await import('./install');
    await runSetup({});
  });

  // ── Setup ─────────────────────────────────────────────────────────────────
  // `install` and `login` are kept as aliases: `npx lurqrun install` is in
  // published docs, dashboard copy and people's notes, and silently breaking it
  // would be worse than carrying two extra words here.
  program
    .command('setup')
    .aliases(['install', 'login'])
    .description('one-time setup: store your API key, wire up your assistants and skills')
    .option('--api-key <key>', 'hosted API key (skips the prompt)')
    .option('--url <url>', 'hosted endpoint URL (defaults to the lurq service)')
    .option('--agent <agent>', AGENT_CHOICES)
    .option('--yes', 'non-interactive: use flags/env and detected agents without prompting')
    .option('--no-open', "don't launch a browser (headless boxes, SSH, CI)")
    .action(
      async (opts: {
        apiKey?: string;
        url?: string;
        agent?: string;
        yes?: boolean;
        open?: boolean;
      }) => {
        const { runSetup } = await import('./install');
        await runSetup({ ...opts, noOpen: opts.open === false });
      },
    );

  program
    .command('logout')
    .description('remove the stored API key from this machine')
    .action(async () => {
      const { clearUserConfig, userConfigPath } = await import('../core/userConfig');
      const path = userConfigPath();
      console.log(
        clearUserConfig()
          ? `Removed ${path}. Agent MCP configs still hold the key; re-run \`lurq setup\` to change them.`
          : 'No stored API key on this machine.',
      );
    });

  // ── Asking about packages ─────────────────────────────────────────────────
  // Help lists commands in registration order, so the ones a user actually runs
  // come first and the server/scripting plumbing sits at the bottom.
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
    .option('--target <v>', 'target version (defaults to latest)')
    // Historical spelling of --target, kept working but out of the help text so
    // only one spelling is advertised.
    .addOption(new Option('--version <v>', 'alias for --target').hideHelp())
    .option('--known <v>', 'a version you know; shows the API delta to the target')
    .option('--json', 'output JSON')
    .action(
      async (
        pkg: string,
        opts: { target?: string; version?: string; known?: string; json?: boolean },
      ) => {
        const { runUsage } = await import('./commands');
        await runUsage(pkg, {
          version: opts.target ?? opts.version,
          known: opts.known,
          json: opts.json,
        });
      },
    );

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
    .command('compat')
    .argument('<packages...>', 'npm package names to check together')
    .description('check whether a set of packages forms a coherent stack (peer/engine + recorded evidence)')
    // The checker has always taken exact versions (CheckCompatOptions.versions);
    // there was just no way to say so from the CLI. Arguments are bare names, so
    // `next@15` would look up a package called "next@15" and come back unknown.
    .option('--pin <name=version...>', 'evaluate an exact version, e.g. --pin next=15')
    .option('--json', 'output JSON')
    .action(async (pkgs: string[], opts: { json?: boolean; pin?: string[] }) => {
      const { runCompat } = await import('./commands');
      await runCompat(pkgs, opts);
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

  // ── Upgrade autopilot ─────────────────────────────────────────────────────
  // These two run where the code is (a laptop or a CI runner), not against a
  // local database. `upgrade-plan` asks the index what changed between versions;
  // `check-upgrade` narrows that to what this codebase references, using nothing
  // but the two npm tarballs — no API key, no test suite, no network to us.

  program
    .command('upgrade-plan')
    .argument('[dir]', 'project directory (default: current)', '.')
    .description('what is behind in this project, and what each upgrade removes from its API')
    .option('--json', 'output the plan as JSON (feed to `check-upgrade --plan`)')
    .option('--url <url>', 'hosted endpoint URL (defaults to the lurq service)')
    .option('--api-key <key>', 'hosted API key (defaults to $LURQ_API_KEY)')
    .action(async (dir: string, opts: { json?: boolean; url?: string; apiKey?: string }) => {
      const { buildUpgradePlan, formatUpgradePlan } = await import('./upgradePlan');
      const plan = await buildUpgradePlan(dir, { url: opts.url, apiKey: opts.apiKey });
      console.log(opts.json ? JSON.stringify(plan, null, 2) : formatUpgradePlan(plan));
    });

  program
    .command('check-upgrade')
    .argument('[dir]', 'project directory to scan (default: current)', '.')
    .description('do these upgrades remove symbols your code actually references?')
    .option('--plan <file>', 'targets from `upgrade-plan --json`')
    .option('--upgrade <spec...>', 'pkg@from..to (repeatable), e.g. commander@11.1.0..12.1.0')
    .option('--json', 'output the report as JSON')
    .option('--exit-code', 'exit 1 when the report is not safe (for CI)')
    .action(
      async (
        dir: string,
        opts: { plan?: string; upgrade?: string[]; json?: boolean; exitCode?: boolean },
      ) => {
        const { runCheckUpgrade } = await import('./checkUpgrade');
        await runCheckUpgrade(dir, opts);
      },
    );

  // ── Scoring model ─────────────────────────────────────────────────────────
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

  // ── Plumbing ──────────────────────────────────────────────────────────────
  // Nobody types these to answer a question about a package: `install-skill` is
  // the scriptable half of setup, and the two servers are what a host runs.
  program
    .command('install-skill')
    .description('register lurq as an MCP server in supported AI assistants (scriptable)')
    .option('--agent <agent>', AGENT_CHOICES, 'claude-code')
    .option('--api-key <key>', 'hosted API key (remote install; default mode)')
    .option('--url <url>', 'hosted endpoint URL (defaults to the lurq service)')
    .option('--local', 'self-host: write a local stdio entry using your own DATABASE_URL')
    .action(async (opts: { agent?: string; apiKey?: string; url?: string; local?: boolean }) => {
      const { runInstallSkill } = await import('./installSkill');
      await runInstallSkill(opts);
    });

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

  return program;
}
