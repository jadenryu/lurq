/**
 * CLI command wiring (§13). Built with commander. Each command mirrors an MCP
 * tool or an operational task. Handlers are filled in across milestones M1–M7;
 * the command/option surface here is the final, stable shape.
 *
 * Every command supports `--json` for machine-readable output.
 */
import { Command } from 'commander';
import { SERVER_NAME, VERSION } from '../core/constants';

/** Placeholder used until a command's milestone lands. Keeps the CLI runnable
 *  and self-documenting while the build is in progress. */
function comingIn(milestone: string): (...args: unknown[]) => void {
  return () => {
    console.error(
      `\`${SERVER_NAME}\`: this command is implemented in milestone ${milestone}. ` +
        `The scaffold and command surface are in place.`,
    );
    process.exitCode = 1;
  };
}

export function buildProgram(): Command {
  const program = new Command();

  program
    .name(SERVER_NAME)
    .description(
      'lurq — a fresh, objectively-scored index of JS/TS packages for AI coding agents.',
    )
    .version(VERSION, '-v, --version', 'output the lurq version');

  program
    .command('serve')
    .description('start the MCP server over stdio (for agent integration)')
    .action(comingIn('M5'));

  program
    .command('sync')
    .description('run ingestion: refresh scores for the seed list (or one package)')
    .option('--full', 'force a full re-sync, ignoring cache TTLs')
    .option('--package <name>', 'sync a single package by name')
    .action(comingIn('M3'));

  program
    .command('recommend')
    .argument('<need>', 'natural-language description of what you need')
    .description('recommend the best current packages for a described need')
    .option('--category <category>', 'restrict to a taxonomy category')
    .option('--min-confidence <level>', 'proven | emerging | unproven')
    .option('--json', 'output JSON instead of a table')
    .action(comingIn('M6'));

  program
    .command('evaluate')
    .argument('<package>', 'npm package name')
    .description('full evidence read for one package (scores, signals, usage guide)')
    .option('--json', 'output JSON instead of a table')
    .action(comingIn('M6'));

  program
    .command('compare')
    .argument('<packages...>', '2–5 npm package names')
    .description('side-by-side comparison of packages, ranked by health')
    .option('--json', 'output JSON instead of a table')
    .action(comingIn('M6'));

  program
    .command('verify')
    .argument('<package>', 'npm package name')
    .description('safety check: is this package real, healthy, and not risky?')
    .option('--json', 'output JSON instead of a table')
    .action(comingIn('M6'));

  program
    .command('install-skill')
    .description('register lurq as an MCP server in supported AI assistants')
    .option(
      '--agent <agent>',
      'claude-code | cursor | copilot | windsurf | all',
      'claude-code',
    )
    .action(comingIn('M7'));

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
