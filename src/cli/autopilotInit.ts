/**
 * `lurq autopilot init` — the whole repository setup in one command.
 *
 * The flow it replaces was five things in three windows: mint a key in the
 * dashboard, copy it, set it as a repository secret, create a workflow file
 * through GitHub's new-file page, and set an Anthropic credential if the repo
 * runs the agent. Every one of those is a place to stop, and the agent brief
 * that automates them is a paste into a chat window.
 *
 * WHAT IT WILL NOT DO. It never commits and never pushes. Committing the
 * workflow is what grants write access to the repository, so that stays a
 * decision made by a person reading a diff — the same boundary the dashboard
 * holds. It also never puts a secret in argv, where any other process on the
 * machine can read it out of `ps`; every secret goes to `gh` on stdin.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { detectInstallCommand, renderWorkflow, WORKFLOW_PATH } from '../github/workflow';
import { resolveApiKey } from '../core/userConfig';
import { logger } from '../core/logger';
import { bold, dim, green, yellow } from './format';

export type InitMode = 'comment' | 'fix' | 'pr';

export interface InitOptions {
  repo?: string;
  mode?: string;
  apiKey?: string;
  credential?: boolean;
  force?: boolean;
  json?: boolean;
  cwd?: string;
}

/** Every lockfile `detectInstallCommand` knows how to read, checked in the repo root. */
const LOCKFILES = ['package-lock.json', 'yarn.lock', 'pnpm-lock.yaml', 'bun.lockb', 'bun.lock'];

/**
 * `owner/name` out of whatever `git remote get-url origin` prints.
 *
 * Covers the three shapes a real checkout has — ssh, https, and the scp-style
 * `git@` form — because a command that only works on one of them fails for
 * whichever half of users cloned the other way, and fails at step one.
 */
export function parseRepoFromRemote(url: string): string | null {
  const trimmed = url.trim().replace(/\.git$/, '');
  if (!trimmed) return null;
  const match =
    // git@github.com:owner/name  |  ssh://git@github.com/owner/name
    trimmed.match(/^(?:ssh:\/\/)?git@[^:/]+[:/]([^/]+)\/([^/]+)$/) ??
    // https://github.com/owner/name
    trimmed.match(/^https?:\/\/[^/]+\/([^/]+)\/([^/]+)$/);
  if (!match) return null;
  const [, owner, name] = match;
  return owner && name ? `${owner}/${name}` : null;
}

/** `pr` is the only mode that runs a model, so it is the only one needing a credential. */
export function needsAgentCredential(mode: InitMode): boolean {
  return mode === 'pr';
}

function parseMode(raw: string | undefined): InitMode {
  if (!raw) return 'fix';
  if (raw === 'comment' || raw === 'fix' || raw === 'pr') return raw;
  throw new Error(`Unknown mode "${raw}". Use comment, fix, or pr.`);
}

/** Run a command for its output. Never receives a secret in `args`. */
function run(cmd: string, args: string[], cwd?: string) {
  return spawnSync(cmd, args, { cwd, encoding: 'utf8' });
}

function have(cmd: string): boolean {
  const res = run(cmd, ['--version']);
  return res.status === 0;
}

/**
 * Hand a secret to `gh` on stdin.
 *
 * `gh secret set NAME --body VALUE` would put the credential in this process's
 * argv, which is world-readable on most systems for as long as the process
 * lives. Without `--body`, gh reads the value from stdin.
 */
function setSecret(repo: string, name: string, value: string): boolean {
  const res = spawnSync('gh', ['secret', 'set', name, '--repo', repo], {
    input: value,
    encoding: 'utf8',
  });
  if (res.status !== 0) {
    logger.error(`  could not set ${name}: ${(res.stderr || res.stdout || '').trim()}`);
    return false;
  }
  return true;
}

/**
 * `claude setup-token` prints the token on stdout after an interactive sign-in.
 *
 * stdin and stderr are inherited so the sign-in prompts still reach the user's
 * terminal; only stdout is captured, which is where the token lands. If that
 * capture comes back as anything but a single opaque line — a different claude
 * version, an aborted sign-in, a prompt written to stdout after all — this
 * returns null and the caller tells the user what to do by hand rather than
 * storing whatever it happened to catch.
 */
function mintClaudeToken(): string | null {
  const res = spawnSync('claude', ['setup-token'], {
    stdio: ['inherit', 'pipe', 'inherit'],
    encoding: 'utf8',
  });
  if (res.status !== 0) return null;
  const lines = (res.stdout ?? '')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);
  const token = lines[lines.length - 1];
  if (!token || token.includes(' ') || token.length < 20) return null;
  return token;
}

export async function runAutopilotInit(opts: InitOptions): Promise<void> {
  const cwd = opts.cwd ?? process.cwd();
  const mode = parseMode(opts.mode);
  const done: string[] = [];
  const todo: string[] = [];

  // 1. Which repository.
  let repo = opts.repo?.trim();
  if (!repo) {
    const remote = run('git', ['remote', 'get-url', 'origin'], cwd);
    repo = (remote.status === 0 && parseRepoFromRemote(remote.stdout)) || undefined;
  }
  if (!repo) {
    logger.error('Could not work out which repository this is.');
    logger.error('Pass it: lurq autopilot init --repo owner/name');
    process.exitCode = 1;
    return;
  }

  // 2. The key that lets the workflow ask lurq what is outstanding.
  const apiKey = resolveApiKey(opts.apiKey);
  if (!apiKey) {
    logger.error('No lurq API key on this machine. Run `lurq setup` first, then this again.');
    process.exitCode = 1;
    return;
  }

  // 3. gh, which is how every write here happens — under the user's own auth,
  //    not a token lurq holds.
  if (!have('gh')) {
    logger.error('The GitHub CLI (`gh`) is not installed. https://cli.github.com');
    process.exitCode = 1;
    return;
  }
  if (run('gh', ['auth', 'status']).status !== 0) {
    logger.error('`gh` is not signed in. Run `gh auth login`, then this again.');
    process.exitCode = 1;
    return;
  }

  logger.info(`${bold('repository')}  ${repo}`);
  logger.info(`${bold('mode')}        ${mode}\n`);

  // 4. The secret.
  if (setSecret(repo, 'LURQ_API_KEY', apiKey)) done.push('LURQ_API_KEY set as a repository secret');
  else {
    process.exitCode = 1;
    return;
  }

  // 5. The workflow file. Written, never committed.
  const path = join(cwd, WORKFLOW_PATH);
  if (existsSync(path) && !opts.force) {
    done.push(`${WORKFLOW_PATH} already exists (left alone; --force overwrites)`);
  } else {
    const lockfiles = LOCKFILES.filter((f) => existsSync(join(cwd, f)));
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, renderWorkflow({ mode, installCommand: detectInstallCommand(lockfiles) }));
    done.push(`${WORKFLOW_PATH} written`);
  }

  // 6. The Anthropic credential, only for the mode that runs a model.
  if (needsAgentCredential(mode) && opts.credential !== false) {
    if (!have('claude')) {
      todo.push(
        'Set ANTHROPIC_API_KEY (from the Anthropic console) as a repository secret — pr mode fails without a credential:\n' +
          `    gh secret set ANTHROPIC_API_KEY --repo ${repo}`,
      );
    } else {
      logger.info(dim('Minting a Claude token — sign in when prompted.'));
      const token = mintClaudeToken();
      if (token && setSecret(repo, 'CLAUDE_CODE_OAUTH_TOKEN', token)) {
        done.push('CLAUDE_CODE_OAUTH_TOKEN set as a repository secret');
        todo.push(
          yellow('That token expires one year from today, with no warning.') +
            ' This is a scheduled job, so it will work for a year and then stop.\n' +
            '    An ANTHROPIC_API_KEY from the console does not expire, and is the right one if anyone else maintains this repo.',
        );
      } else {
        todo.push(
          'Could not read a token back from `claude setup-token`. Set one by hand:\n' +
            `    claude setup-token\n` +
            `    gh secret set CLAUDE_CODE_OAUTH_TOKEN --repo ${repo}`,
        );
      }
    }
  }

  // 7. Stop. The commit is the user's.
  todo.push(
    `Read the workflow, then commit it — that commit is what grants write access:\n` +
      `    git add ${WORKFLOW_PATH} && git commit -m "ci: lurq upgrade autopilot" && git push`,
  );

  if (opts.json) {
    logger.info(JSON.stringify({ repo, mode, done, todo: todo.length }, null, 2));
    return;
  }

  logger.info('');
  for (const line of done) logger.info(`${green('✓')} ${line}`);
  logger.info(`\n${bold('Next')}`);
  for (const line of todo) logger.info(`  · ${line}`);
}

/** Exported for the setup card in the dashboard to stay honest about the path it prints. */
export function workflowExists(cwd: string): boolean {
  return existsSync(join(cwd, WORKFLOW_PATH));
}

/** Read the workflow a previous run wrote, for tests and for `--json` callers. */
export function readWorkflow(cwd: string): string | null {
  const path = join(cwd, WORKFLOW_PATH);
  return existsSync(path) ? readFileSync(path, 'utf8') : null;
}
