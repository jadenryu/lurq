/**
 * CLI command wiring (§13). Built with commander. Each command mirrors an MCP
 * tool or an operational task. Handlers are filled in across milestones M1–M7;
 * the command/option surface here is the final, stable shape.
 *
 * Every command supports `--json` for machine-readable output.
 */
import { Command, Option } from 'commander';
import { KEYS_URL, SERVER_NAME, VERSION } from '../core/constants';
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
    .description('lurq - a fresh, objectively-scored index of JS/TS packages for AI coding agents.')
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
        `coding agent on this machine. Get a key at ${KEYS_URL}\n`,
    );

  // Bare `npx lurqrun` (or a bare `lurq`) on an unconfigured machine runs setup.
  // That is the whole one-command install story: one thing to type, and the user
  // ends up with the command on their PATH, a stored key, and every agent wired.
  // Once a key exists, a bare `lurq` means "what can this do?" instead, so it
  // prints help rather than re-running a wizard nobody asked for.
  program.action(async (_opts: unknown, cmd: Command) => {
    // A root action makes commander pass anything it does not recognise here as
    // operands, so `lurq evalute zod` started setup (no key) or printed help and
    // exited 0 (with one): a typo that looked like success. Anything after the
    // bare command is an unknown command; report it the way commander would
    // without a root action, with its "did you mean" and a non-zero exit.
    // `unknownCommand` is public in commander's source but missing from its types.
    if (cmd.args.length > 0) {
      (program as Command & { unknownCommand(): never }).unknownCommand();
    }
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
    // The detached half of setup from an agent's shell (agentLink.ts). Not for people.
    .addOption(new Option('--wait-for-signin').hideHelp())
    .action(
      async (opts: {
        apiKey?: string;
        url?: string;
        agent?: string;
        yes?: boolean;
        open?: boolean;
        waitForSignin?: boolean;
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
          ? `Removed ${path}. Your agents' MCP configs still hold the key: \`lurq uninstall\` removes those too.`
          : 'No stored API key on this machine. To remove lurq from your agents, run `lurq uninstall`.',
      );
    });

  program
    .command('uninstall')
    .description("undo setup: remove lurq's MCP entries, agent instructions and the stored key")
    .option('--agent <agent>', `only this agent: ${AGENT_CHOICES}`)
    .option('--yes', 'remove without asking')
    .action(async (opts: { agent?: string; yes?: boolean }) => {
      const { runUninstall } = await import('./uninstall');
      await runUninstall(opts);
    });

  // Selection policy as a file in the repo: pull it, review changes in a PR,
  // push from CI. Pushing needs a key with the policy:write scope, which the key
  // `setup` stores never has.
  const policy = program
    .command('policy')
    .description('keep your selection policy in a file: pull it, review it, push it');

  policy
    .command('pull')
    .argument('[file]', 'write the policy here (default: stdout)')
    .description('download the policy your agents are held to')
    .option('--url <url>', 'hosted endpoint URL (defaults to the lurq service)')
    .option('--api-key <key>', 'hosted API key (defaults to $LURQ_API_KEY)')
    .action(async (file: string | undefined, opts: { url?: string; apiKey?: string }) => {
      const { runPolicyPull } = await import('./policy');
      await runPolicyPull(file, opts);
    });

  policy
    .command('push')
    .argument('<file>', 'policy JSON, as written by `lurq policy pull`')
    .description('replace the policy with this file (needs a policy:write key)')
    .option('--check', 'validate the file only; send nothing (for PR checks)')
    .option('--url <url>', 'hosted endpoint URL (defaults to the lurq service)')
    .option('--api-key <key>', 'hosted API key (defaults to $LURQ_API_KEY)')
    .action(
      async (file: string, opts: { check?: boolean; url?: string; apiKey?: string }) => {
        const { runPolicyPush } = await import('./policy');
        await runPolicyPush(file, opts);
      },
    );

  policy
    .command('history')
    .description('who changed the policy, from where, and what changed')
    .option('--json', 'output the changes as JSON')
    .option('--url <url>', 'hosted endpoint URL (defaults to the lurq service)')
    .option('--api-key <key>', 'hosted API key (defaults to $LURQ_API_KEY)')
    .action(async (opts: { json?: boolean; url?: string; apiKey?: string }) => {
      const { runPolicyHistory } = await import('./policy');
      await runPolicyHistory(opts);
    });

  policy
    .command('log')
    .description('packages the policy refused, or warned about, grouped by rule')
    .option('--days <n>', 'look back this many days, 1 to 365 (default 30)')
    .option('--json', 'output the log as JSON')
    .option('--url <url>', 'hosted endpoint URL (defaults to the lurq service)')
    .option('--api-key <key>', 'hosted API key (defaults to $LURQ_API_KEY)')
    .action(async (opts: { days?: string; json?: boolean; url?: string; apiKey?: string }) => {
      const { runPolicyLog } = await import('./policy');
      await runPolicyLog(opts);
    });

  // Answers "can lurq do X" without making anyone read `--help` twice. Local
  // and instant: the catalog ships in the binary, so this works before setup and
  // offline.
  program
    .command('can')
    .argument('[query...]', 'what you are trying to do, in plain words')
    .description('find the lurq capability for what you are trying to do')
    .option('--json', 'output matches as JSON')
    .action(async (query: string[], opts: { json?: boolean }) => {
      const { runCan } = await import('./commands');
      runCan(query.join(' '), opts);
    });

  // ── Asking about packages ─────────────────────────────────────────────────
  // Help lists commands in registration order, so the ones a user actually runs
  // come first and the server/scripting plumbing sits at the bottom.
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
    .description(
      'version-exact API surface (exported symbols/signatures) + drift from a known version',
    )
    .option('--target <v>', 'target version (defaults to latest)')
    // Historical spelling of --target, kept working but out of the help text so
    // only one spelling is advertised.
    .addOption(new Option('--version <v>', 'alias for --target').hideHelp())
    .option('--known <v>', 'a version you know; shows the API delta to the target')
    .option('--query <text>', 'only symbols whose name contains this')
    .option('--offset <n>', 'first symbol to show, to page past the first 80', (v) =>
      Math.max(0, parseInt(v, 10) || 0),
    )
    .option('--json', 'output JSON')
    .action(
      async (
        pkg: string,
        opts: {
          target?: string;
          version?: string;
          known?: string;
          query?: string;
          offset?: number;
          json?: boolean;
        },
      ) => {
        const { runUsage } = await import('./commands');
        await runUsage(pkg, {
          version: opts.target ?? opts.version,
          known: opts.known,
          query: opts.query,
          offset: opts.offset,
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
    .description(
      'check whether a set of packages forms a coherent stack (peer/engine + recorded evidence)',
    )
    // The checker has always taken exact versions (CheckCompatOptions.versions);
    // there was just no way to say so from the CLI. Arguments are bare names, so
    // `next@15` would look up a package called "next@15" and come back unknown.
    .option('--pin <name=version...>', 'evaluate an exact version, e.g. --pin next=15')
    .option('--json', 'output JSON')
    .action(async (pkgs: string[], opts: { json?: boolean; pin?: string[] }) => {
      const { runCompat } = await import('./commands');
      await runCompat(pkgs, opts);
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
    .option('--repo <owner/name>', "apply this repo's policy (defaults to $GITHUB_REPOSITORY)")
    .action(
      async (
        dir: string,
        opts: { json?: boolean; url?: string; apiKey?: string; repo?: string },
      ) => {
        const { buildUpgradePlan, formatUpgradePlan } = await import('./upgradePlan');
        const plan = await buildUpgradePlan(dir, {
          url: opts.url,
          apiKey: opts.apiKey,
          repo: opts.repo,
        });
        console.log(opts.json ? JSON.stringify(plan, null, 2) : formatUpgradePlan(plan));
      },
    );

  program
    .command('check-upgrade')
    .argument('[dir]', 'project directory to scan (default: current)', '.')
    .description('do these upgrades remove symbols your code actually references?')
    .option('--plan <file>', 'targets from `upgrade-plan --json`')
    .option('--upgrade <spec...>', 'pkg@from..to (repeatable), e.g. commander@11.1.0..12.1.0')
    .option('--json', 'output the report as JSON')
    .option('--exit-code', 'exit 1 when the report is not safe (for CI)')
    // Opt-in, and never load-bearing: the check's whole point is that it needs
    // no key and no network to us, so this only adds a dashboard write on top.
    .option('--report', 'send the result to your lurq dashboard (CI; needs an API key)')
    .option('--url <url>', 'hosted endpoint URL (defaults to the lurq service)')
    .option('--api-key <key>', 'hosted API key (defaults to $LURQ_API_KEY)')
    .option('--no-types', 'skip the type check (runtime surface only; faster)')
    .action(
      async (
        dir: string,
        opts: {
          plan?: string;
          upgrade?: string[];
          json?: boolean;
          exitCode?: boolean;
          report?: boolean;
          url?: string;
          apiKey?: string;
          types?: boolean;
        },
      ) => {
        const { runCheckUpgrade } = await import('./checkUpgrade');
        await runCheckUpgrade(dir, opts);
      },
    );

  // The half of check-upgrade that writes. Only changes lurq can prove from the
  // two tarballs — a symbol renamed within one declaration — and a diff by
  // default, because the first run of anything that edits your source should be
  // readable before it is trusted.
  program
    .command('fix')
    .argument('[dir]', 'project directory to scan (default: current)', '.')
    .description('write the upgrade changes that need no judgement, and brief the agent on the rest')
    // With neither --plan nor --upgrade it works out what moved by itself, which
    // is the only part that asks our API anything. Naming the versions keeps the
    // whole run offline.
    .option('--plan <file>', 'targets from `upgrade-plan --json`')
    .option('--upgrade <spec...>', 'pkg@from..to (repeatable), e.g. cookie@1.1.1..2.0.1 — needs no API key')
    .option('--apply', 'write the files (default: print the diff and change nothing)')
    .option('--json', 'output the result as JSON')
    .option('--exit-code', 'exit 1 when something is left for a human or an agent to do')
    .option('--sarif <file>', 'write SARIF for GitHub code scanning (upload with codeql-action/upload-sarif)')
    .option('--url <url>', 'hosted endpoint URL (defaults to the lurq service)')
    .option('--api-key <key>', 'hosted API key (defaults to $LURQ_API_KEY)')
    .option('--repo <owner/name>', "apply this repo's policy (defaults to $GITHUB_REPOSITORY)")
    .action(
      async (
        dir: string,
        opts: {
          plan?: string;
          upgrade?: string[];
          apply?: boolean;
          json?: boolean;
          exitCode?: boolean;
          sarif?: string;
          url?: string;
          apiKey?: string;
          repo?: string;
        },
      ) => {
        const { runFix } = await import('./fix');
        await runFix(dir, opts);
      },
    );

  // The same diff, pointed at the author instead of the consumer: does the
  // version about to be published match what this release actually did to the
  // API? Needs no key and no network to us — just the registry tarball.
  program
    .command('check-release')
    .argument('[dir]', 'package directory (default: current)', '.')
    .description('is the version you are about to publish honest about what changed?')
    .option('--against <version>', 'compare with this published version (default: latest)')
    .option('--json', 'output the check as JSON')
    .option('--exit-code', 'exit 1 when the bump is understated (for CI / prepublish)')
    .action(async (dir: string, opts: { against?: string; json?: boolean; exitCode?: boolean }) => {
      const { checkRelease, formatReleaseCheck } = await import('../surface/release');
      const check = await checkRelease(dir, { against: opts.against });
      console.log(opts.json ? JSON.stringify(check, null, 2) : formatReleaseCheck(check));
      if (opts.exitCode && check.verdict !== 'ok') process.exitCode = 1;
    });

  // The "works on my machine" gap. Reads the project's own source and its
  // `.env*` files; no API key, no network, and never a value.
  program
    .command('check-env')
    .argument('[dir]', 'project directory to scan (default: current)', '.')
    .description('which environment variables does this project read that nothing declares?')
    .option('--json', 'output the result as JSON')
    .option('--exit-code', 'exit 1 when anything is undeclared (for CI)')
    .option('--sarif <file>', 'write SARIF for GitHub code scanning')
    .option('--limit <n>', 'source files to read before stopping (default 5000)')
    .action(
      async (dir: string, opts: { json?: boolean; exitCode?: boolean; sarif?: string; limit?: string }) => {
        const { runEnvCheck } = await import('./envCheck');
        await runEnvCheck(dir, opts);
      },
    );

  // The same question as check-upgrade, asked by the other party: not "will this
  // dependency break me" but "will this change break the people calling me".
  // Reads two git revisions of an OpenAPI document — nothing leaves the machine.
  program
    .command('check-api')
    .argument('[spec]', 'OpenAPI document (default: the first one found)')
    .description('does this change break the callers of your own API?')
    .option('--against <rev>', 'git revision to compare with (default: HEAD)')
    .option('-C, --dir <dir>', 'repository directory (default: current)', '.')
    .option('--json', 'output the check as JSON')
    .option('--exit-code', 'exit 1 on a breaking change (for CI)')
    .action(
      async (
        spec: string | undefined,
        opts: { against?: string; dir?: string; json?: boolean; exitCode?: boolean },
      ) => {
        const { runApiCheck } = await import('../api/check');
        const { formatApiCheck } = await import('../api/diff');
        const check = await runApiCheck(opts.dir ?? '.', { spec, against: opts.against });
        console.log(
          opts.json
            ? JSON.stringify(check, null, 2)
            : formatApiCheck(check, `api check (vs ${check.against})`),
        );
        if (opts.exitCode && check.verdict !== 'ok') process.exitCode = 1;
      },
    );

  // ── Scoring model ─────────────────────────────────────────────────────────
  program
    .command('audit')
    .argument('[dir]', 'project directory (defaults to the current one)')
    .description('what this project depends on, and what is outdated, vulnerable or drifting')
    .option('--project-only', 'ignore user-level agent configs; read only files in the project')
    .option(
      '--probe',
      'probe your MCP servers now instead of waiting for the worker (self-hosted index only)',
    )
    .option('--probe-budget <seconds>', 'wall-clock ceiling for probing (default 90)')
    .option('--json', 'output JSON instead of a table')
    .action(
      async (
        dir: string | undefined,
        opts: { json?: boolean; projectOnly?: boolean; probe?: boolean; probeBudget?: string },
      ) => {
        const { runAudit } = await import('./commands');
        await runAudit(dir, opts);
      },
    );

  program
    .command('mcp-scan')
    .argument('[dir]', 'project directory (defaults to the current one)')
    .description(
      'connect to every MCP server you have configured and read what it really exposes: its tools, what they do, anything steering your agent, and what changed since the last scan',
    )
    .option('--project-only', 'read only config files in the project')
    .option('--trust-project', 'launch servers committed to the repository without asking')
    .option('--only <aliases>', 'comma-separated server names to scan')
    .option('--timeout <seconds>', 'per-server connect deadline (default 60)')
    .option('--concurrency <n>', 'servers scanned at once (default 4)')
    .option(
      '--fail-on <severity>',
      'exit 1 when anything this severe is found: critical | high | moderate | low | none',
      'none',
    )
    .option('--no-history', 'do not compare with, or record, the previous scan')
    .option('--no-upload', 'keep this scan on this machine; do not record it to your account')
    .option('--require-upload', 'exit 1 if the scan could not be recorded to your account (for CI)')
    .option('--github-issue', "keep a pinned 'lurq dashboard' issue current in this repository (in GitHub Actions)")
    .option(
      '--no-contribute',
      "do not offer published servers' contracts as corroboration for the public index",
    )
    .option('--json', 'output JSON instead of a report')
    .option('--sarif <file>', 'write SARIF for GitHub code scanning (upload with codeql-action/upload-sarif)')
    .action(async (dir: string | undefined, opts: import('./mcpScan').McpScanCliOpts) => {
      const { runMcpScan } = await import('./mcpScan');
      await runMcpScan(dir, opts);
    });

  program
    .command('mcp-ci')
    .argument('[dir]', 'repository directory (defaults to the current one)')
    .description("write a GitHub Actions workflow that rescans this repository's MCP servers daily and when their config changes")
    .option('--print', 'print the workflow instead of writing it')
    .option('--force', 'replace an existing workflow file')
    .option('--cron <expr>', 'schedule (default: daily 06:23 UTC)')
    .option('--fail-on <severity>', 'fail the job at this severity: critical | high | moderate | low | none', 'high')
    .option(
      '--sarif',
      'also file findings as GitHub code scanning alerts (needs code scanning enabled; adds security-events: write)',
    )
    .option('--no-issue', 'do not maintain the pinned lurq dashboard issue')
    .action(async (dir: string | undefined, opts: import('./mcpScan').McpCiOpts) => {
      const { runMcpCi } = await import('./mcpScan');
      await runMcpCi(dir, opts);
    });

  program
    .command('mcp-stack')
    .argument('[dir]', 'project directory (defaults to the current one)')
    .description('do your configured MCP servers coexist? checks tool-name collisions and shadowing, live')
    .option('--project-only', 'read only config files in the project')
    .option('--trust-project', 'launch servers committed to the repository without asking')
    .option('--timeout <seconds>', 'per-server connect deadline (default 60)')
    .option('--json', 'output JSON instead of a table')
    .action(
      async (
        dir: string | undefined,
        opts: { json?: boolean; projectOnly?: boolean; trustProject?: boolean; timeout?: string },
      ) => {
        const { runMcpStack } = await import('./commands');
        await runMcpStack(dir, opts);
      },
    );

  program
    .command('mcp-surface')
    .argument('<server>', 'npm package name of the MCP server')
    .description("an MCP server's real tool contract: params and behaviour annotations")
    .option('--version <v>', 'exact version (defaults to the latest probed)')
    .option('--json', 'output JSON instead of a table')
    .action(async (server: string, opts: { version?: string; json?: boolean }) => {
      const { runMcpSurface } = await import('./commands');
      await runMcpSurface(server, opts);
    });

  program
    .command('mcp-drift')
    .argument('<server>', 'npm package name of the MCP server')
    .description('what an MCP server changed between two versions (incl. silent + privilege drift)')
    .requiredOption('--from <v>', 'version you are on')
    .requiredOption('--to <v>', 'version you are moving to')
    .option('--json', 'output JSON instead of a table')
    .action(async (server: string, opts: { from: string; to: string; json?: boolean }) => {
      const { runMcpDrift } = await import('./commands');
      await runMcpDrift(server, opts);
    });

  program
    .command('connect-check')
    .argument('<server>', 'endpoint URL, official registry name, or npm package name')
    .description('will this MCP server work in your client, and what does it take? (per-client verdicts + config)')
    .option('--client <id>', 'one client: claude-code, claude-ai, chatgpt, cursor, vscode, codex, gemini-cli, …')
    .option('--json', 'output JSON instead of a table')
    .action(async (server: string, opts: { client?: string; json?: boolean }) => {
      const { runConnectCheck } = await import('./commands');
      await runConnectCheck(server, opts);
    });

  program
    .command('mcp-pin')
    .argument('<server>', 'endpoint URL or official registry name of a remote MCP server')
    .description('approve a remote MCP server as it is now; you are alerted when its tools or sign-in path change')
    .option('--note <text>', 'why it was approved, shown with the pin')
    .option('--json', 'output JSON')
    .action(async (server: string, opts: { note?: string; json?: boolean }) => {
      const { runMcpPin } = await import('./commands');
      await runMcpPin(server, opts);
    });

  program
    .command('mcp-unpin')
    .argument('<server>', 'endpoint URL or official registry name')
    .description('stop watching a pinned remote MCP server')
    .action(async (server: string) => {
      const { runMcpUnpin } = await import('./commands');
      await runMcpUnpin(server);
    });

  program
    .command('mcp-pins')
    .description('your pinned remote MCP servers, and which changed since you pinned them')
    .option('--json', 'output JSON')
    .action(async (opts: { json?: boolean }) => {
      const { runMcpPins } = await import('./commands');
      await runMcpPins(opts);
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
    .option(
      '--set <pair>',
      'override key=value, e.g. composite.lambda=0.5 (repeatable)',
      (v: string, acc: string[]) => acc.concat(v),
      [],
    )
    .option('--reset', 'remove all overrides and restore defaults')
    .option('--explain <component>', 'explain a component (e.g. adoption, quality, lambda)')
    .option('--project', 'write to project-local .lurq/weights.json instead of the user config')
    .action(
      async (opts: { set?: string[]; reset?: boolean; explain?: string; project?: boolean }) => {
        const { runEditWeights } = await import('./commands');
        await runEditWeights(opts);
      },
    );

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
    .command('hook')
    .argument('<event>', 'the agent event being handled: session-start, prompt, pre-tool-use, post-tool-use')
    .option('--agent <agent>', 'whose hook format to read and write: claude, codex or cursor', 'claude')
    .description('run as an agent hook: verify installs and suggest lurq where it helps (set up by `lurq setup`)')
    .action(async (event: string, opts: { agent: string }) => {
      const { runHook } = await import('./hook');
      await runHook(event, opts.agent);
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
