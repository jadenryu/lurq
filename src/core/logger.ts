/**
 * Minimal leveled logger.
 *
 * IMPORTANT: all output goes to **stderr**. The MCP server communicates over
 * stdio (stdout is the protocol channel), so anything written to stdout would
 * corrupt the JSON-RPC stream. Never log to stdout.
 */

const LEVELS = { error: 0, warn: 1, info: 2, debug: 3 } as const;
export type LogLevel = keyof typeof LEVELS;

function currentLevel(): number {
  const raw = process.env.LOG_LEVEL as LogLevel | undefined;
  return raw && raw in LEVELS ? LEVELS[raw] : LEVELS.info;
}

function emit(level: LogLevel, args: unknown[]): void {
  if (LEVELS[level] > currentLevel()) return;
  const parts = args.map((a) =>
    typeof a === 'string' ? a : a instanceof Error ? (a.stack ?? a.message) : safeStringify(a),
  );
  process.stderr.write(`[lurq] ${level.toUpperCase()} ${parts.join(' ')}\n`);
}

function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

export const logger = {
  error: (...args: unknown[]) => emit('error', args),
  warn: (...args: unknown[]) => emit('warn', args),
  info: (...args: unknown[]) => emit('info', args),
  debug: (...args: unknown[]) => emit('debug', args),
};
