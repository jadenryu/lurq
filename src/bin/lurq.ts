#!/usr/bin/env node
/**
 * lurq CLI entry point. Runnable via `npx lurq <command>` (§7, §13).
 */
import { maintainHooks } from '../cli/autoHooks';
import { buildProgram } from '../cli/index';
import { withSetupOnMissingKey } from '../cli/install';
import { notifyOnUpdate } from '../cli/updateCheck';
import { loadEnv } from '../core/config';
import { enforceGate } from '../core/gate';
import { logger } from '../core/logger';
import { selfHostHint } from '../core/selfHost';

loadEnv();

// Private-preview gate: non-owners get a placeholder, the owner runs as usual.
// Runs after loadEnv so LURQ_OWNER_KEY from a .env file is honored too.
enforceGate(process.argv.slice(2));

const argv = process.argv.slice(2);
notifyOnUpdate(argv);

// Before the command, so a due hook run repairs its own hooks first. At most once a day; never rejects.
maintainHooks(argv)
  // A fresh program per attempt: commander instances are single-use.
  .then(() => withSetupOnMissingKey(() => buildProgram().parseAsync(process.argv)))
  .catch((err) => {
    logger.error(selfHostHint(err) ?? (err instanceof Error ? err.message : String(err)));
    process.exit(1);
  });
