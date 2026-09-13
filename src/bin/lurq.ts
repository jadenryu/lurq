#!/usr/bin/env node
/**
 * lurq CLI entry point. Runnable via `npx lurq <command>` (§7, §13).
 */
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

notifyOnUpdate(process.argv.slice(2));

// A fresh program per attempt: commander instances are single-use.
withSetupOnMissingKey(() => buildProgram().parseAsync(process.argv))
  .catch((err) => {
    logger.error(selfHostHint(err) ?? (err instanceof Error ? err.message : String(err)));
    process.exit(1);
  });
