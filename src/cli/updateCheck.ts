/**
 * The "a newer lurqrun is out" line, with at most one registry check a day.
 *
 * This used to be update-notifier, which put 51 packages (boxen, chalk,
 * configstore, latest-version, registry-auth-token…) into every `npx lurqrun`
 * to print one sentence, a third of the whole install. The contract is the same:
 *   - the check runs in a detached background process, so no command waits on
 *     the network and an offline machine notices nothing;
 *   - the banner comes from the previous check and prints on exit, to stderr;
 *   - silent for machines and protocols: MCP stdio servers, `--json`, CI, pipes,
 *     and anyone who sets NO_UPDATE_NOTIFIER.
 */
import { spawn } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import semver from 'semver';
import { PACKAGE_NAME, VERSION } from '../core/constants';
import { yellow } from './format';

const DAY_MS = 24 * 60 * 60 * 1000;

export interface UpdateState {
  checkedAt: number;
  latest?: string;
}

function statePath(): string {
  return join(process.env.XDG_CACHE_HOME || join(homedir(), '.cache'), 'lurq', 'update-check.json');
}

/** Given what the last check stored: the banner to print, and whether to check again. */
export function planUpdateCheck(
  state: UpdateState | null,
  now: number,
  current: string = VERSION,
): { message: string | null; refresh: boolean } {
  const latest = state?.latest;
  const newer =
    latest && semver.valid(latest) && semver.valid(current) && semver.gt(latest, current);
  return {
    message: newer
      ? `Update available: ${current} → ${latest}. Run: npm install -g ${PACKAGE_NAME}`
      : null,
    refresh: !state || !(now - state.checkedAt < DAY_MS),
  };
}

// Runs in the detached child via `node -e`, where argv[1..] are the arguments.
const FETCH_LATEST = `
const [url, file] = process.argv.slice(1);
fetch(url, { signal: AbortSignal.timeout(10000) })
  .then((r) => r.json())
  .then((p) => require('fs').writeFileSync(file, JSON.stringify({ checkedAt: Date.now(), latest: p.version })))
  .catch(() => {});
`;

export function notifyOnUpdate(argv: string[]): void {
  const quiet =
    argv[0] === 'serve' ||
    argv[0] === 'serve-http' ||
    argv.includes('--json') ||
    !process.stdout.isTTY ||
    !!process.env.CI ||
    'NO_UPDATE_NOTIFIER' in process.env;
  if (quiet) return;

  // Never fatal: a read-only home, a corrupt state file or a missing node binary
  // must not break the command the user actually asked for.
  try {
    const path = statePath();
    let state: UpdateState | null = null;
    try {
      state = JSON.parse(readFileSync(path, 'utf8')) as UpdateState;
    } catch {
      /* first run, or unreadable: check again */
    }

    const { message, refresh } = planUpdateCheck(state, Date.now());
    if (message) process.on('exit', () => process.stderr.write(`\n${yellow(message)}\n`));
    if (!refresh) return;

    // Stamped before the check starts, so a burst of commands spawns one check
    // rather than one each.
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, JSON.stringify({ ...state, checkedAt: Date.now() }));
    spawn(
      process.execPath,
      ['-e', FETCH_LATEST, `https://registry.npmjs.org/${PACKAGE_NAME}/latest`, path],
      { detached: true, stdio: 'ignore' },
    ).unref();
  } catch {
    /* see above */
  }
}
