#!/usr/bin/env node
/**
 * lurq OPERATOR entry point (§4E). Owner-only: builds the dataset (sync,
 * discover, worker, mining, sandbox verification, key issuance, schema). Runs
 * from the repo — `npm run operator -- <command>` (or `tsx src/bin/operator.ts`)
 * — and is NOT published, so the read-only `lurq` package never ships ingestion
 * code or its heavy deps (e2b, drizzle-kit). Shares every command the public bin
 * has, plus the operator plane.
 */
import { buildProgram } from '../cli/index';
import { registerOperatorCommands } from '../cli/operator';
import { loadEnv } from '../core/config';
import { logger } from '../core/logger';

loadEnv();

const program = buildProgram();
registerOperatorCommands(program);

program.parseAsync(process.argv).catch((err) => {
  logger.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
