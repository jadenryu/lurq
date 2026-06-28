#!/usr/bin/env node
/**
 * lurq CLI entry point. Runnable via `npx lurq <command>` (§7, §13).
 */
import { readFileSync } from 'node:fs';
import updateNotifier from 'update-notifier';
import { buildProgram } from '../cli/index';
import { loadEnv } from '../core/config';
import { logger } from '../core/logger';

loadEnv();

notifyOnUpdate();

buildProgram()
  .parseAsync(process.argv)
  .catch((err) => {
    logger.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  });

/**
 * Check npm (at most once a day, in a detached background process) and print a
 * one-line "update available" banner on exit when a newer lurqrun is published.
 * Skipped in agent/machine contexts — MCP stdio servers and `--json` output —
 * so the protocol/output stream is never touched. update-notifier additionally
 * only prints in a TTY, so piped runs stay silent regardless. Any failure here
 * must never break the CLI, hence the broad guard.
 */
function notifyOnUpdate(): void {
  const argv = process.argv.slice(2);
  const quiet =
    argv[0] === 'serve' || argv[0] === 'serve-http' || argv.includes('--json');
  if (quiet) return;

  try {
    const pkg = JSON.parse(
      readFileSync(new URL('../../package.json', import.meta.url), 'utf8'),
    ) as { name: string; version: string };
    updateNotifier({ pkg }).notify();
  } catch {
    // Offline, no config dir, malformed metadata — never fatal for the CLI.
  }
}
