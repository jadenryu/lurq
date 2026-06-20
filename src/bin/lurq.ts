#!/usr/bin/env node
/**
 * lurq CLI entry point. Runnable via `npx lurq <command>` (§7, §13).
 */
import { buildProgram } from '../cli/index';
import { loadEnv } from '../core/config';
import { logger } from '../core/logger';

loadEnv();

buildProgram()
  .parseAsync(process.argv)
  .catch((err) => {
    logger.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  });
