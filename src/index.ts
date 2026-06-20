/**
 * Public library surface for `lurq` when imported as a package.
 * The primary interfaces are the MCP server (`lurq serve`) and the CLI;
 * these exports support embedding and testing.
 */
export * from './core/types';
export * from './core/constants';
export { getConfig, requireConfig, loadEnv, ConfigError } from './core/config';
export type { Config } from './core/config';
export { logger } from './core/logger';
export { buildProgram } from './cli/index';
