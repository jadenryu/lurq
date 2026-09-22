/**
 * `lurq autopilot init` — the whole repository setup in one command, for one
 * repository or thirty.
 *
 * The autopilot runs in the user's own Actions, so every repository needs the
 * workflow committed and a secret set. Done by hand that is a new-file page, a
 * commit and a secrets page per repo — fine for one, absurd for thirty. This
 * does all of it over the GitHub API with the user's own `gh` auth: no clone,
 * no checkout, no merge per repository.
 *
 * The trust boundary does not move. lurq's GitHub App still cannot write a
 * byte; every write here is made by the person running the command, under
 * their credentials, to repositories they named. A default branch that refuses
 * a direct commit (protection, rulesets) gets a pull request instead, and
 * `--pr` asks for that everywhere. It also never puts a secret in argv, where
 * any other process on the machine can read it out of `ps`; every secret and
 * every request body goes to `gh` on stdin.
 */
import { spawnSync } from 'node:child_process';
import { detectInstallCommand, renderWorkflow, WORKFLOW_PATH } from '../github/workflow';
import { resolveApiKey } from '../core/userConfig';
import { logger } from '../core/logger';
import { bold, dim, green, red, yellow } from './format';

export type InitMode = 'comment' | 'fix' | 'pr';

export interface InitOptions {
  repo?: string[];
  mode?: string;
  apiKey?: string;
  credential?: boolean;
  force?: boolean;
  pr?: boolean;
  /** Poll the runs this command starts and report how they ended. Default on. */
  watch?: boolean;
  /**
   * Turn on "Allow GitHub Actions to create pull requests" where it is off.
   *
   * Opt-in: it governs every workflow in the repository, not just this one.
   * Without it the check still runs and the remedy is printed.
   */
  allowPrCreation?: boolean;
  json?: boolean;
  cwd?: string;
}

/** What happened to one repository. `failed` is the only outcome that sets exit 1. */
export interface RepoResult {
  repo: string;
  outcome: 'committed' | 'pull-request' | 'exists' | 'failed';
  detail?: string;
  /** Set when a run was dispatched, so the watch step knows what to follow. */
  started?: boolean;
}

const LOCKFILES = ['package-lock.json', 'yarn.lock', 'pnpm-lock.yaml', 'bun.lockb', 'bun.lock'];
/** The branch the PR fallback pushes to. One name, so a re-run updates it instead of piling up. */
const SETUP_BRANCH = 'lurq/autopilot-setup';
const COMMIT_MESSAGE = 'ci: lurq upgrade autopilot';
/** The file name GitHub addresses the workflow by. */
const WORKFLOW_FILE = WORKFLOW_PATH.split('/').pop()!;
/** How long to follow the runs before saying they are still going. */
const WATCH_BUDGET_MS = 180_000;

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

/**
 * True when `gh auth status` lists the token's scopes and `workflow` is not one.
 *
 * GitHub refuses any write under `.github/workflows/` without it, and plain
 * `gh auth login` does not request it — so this is the failure nearly every
 * first run would hit, thirty times, with an opaque 404. A status that lists no
 * scopes at all (a fine-grained token, GH_TOKEN from the environment) is not
 * guessed at: the write itself will say.
 */
export function missingWorkflowScope(authStatus: string): boolean {
  const line = authStatus.split('\n').find((l) => /token scopes:/i.test(l));
  return line !== undefined && !/['"]workflow['"]/.test(line);
}

function parseMode(raw: string | undefined): InitMode {
  if (!raw) return 'fix';
  if (raw === 'comment' || raw === 'fix' || raw === 'pr') return raw;
  throw new Error(`Unknown mode "${raw}". Use comment, fix, or pr.`);
}

/** Run a command for its output. Secrets and bodies only ever go in `input`. */
function run(cmd: string, args: string[], input?: string, cwd?: string) {
  return spawnSync(cmd, args, { cwd, input, encoding: 'utf8' });
}

function have(cmd: string): boolean {
  return run(cmd, ['--version']).status === 0;
}

function errorText(res: ReturnType<typeof run>): string {
  return (res.stderr || res.stdout || '').trim().split('\n')[0] ?? 'unknown error';
}

/** `gh api`, returning the parsed body or throwing gh's own first error line. */
function ghApi<T>(path: string, method = 'GET', body?: unknown): T {
  const args = ['api', '-X', method, path];
  if (body !== undefined) args.push('--input', '-');
  const res = run('gh', args, body === undefined ? undefined : JSON.stringify(body));
  if (res.status !== 0) throw new Error(errorText(res));
  return (res.stdout.trim() ? JSON.parse(res.stdout) : null) as T;
}

/** `gh secret set` reads the value from stdin when `--body` is absent. */
function setSecret(repo: string, name: string, value: string): string | null {
  const res = run('gh', ['secret', 'set', name, '--repo', repo], value);
  return res.status === 0 ? null : `could not set ${name}: ${errorText(res)}`;
}

/**
 * `claude setup-token` prints the token on stdout after an interactive sign-in.
 *
 * stdin and stderr are inherited so the sign-in prompts still reach the user's
 * terminal; only stdout is captured, which is where the token lands. Anything
 * but a single opaque last line returns null rather than storing whatever it
 * happened to catch.
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

/**
 * Put the workflow on `branch`, creating or (with `sha`) replacing it.
 * The Contents API makes the commit server-side, which is why no clone is needed.
 */
function putWorkflow(repo: string, branch: string, content: string, sha?: string): void {
  ghApi(`repos/${repo}/contents/${WORKFLOW_PATH}`, 'PUT', {
    message: COMMIT_MESSAGE,
    content: Buffer.from(content).toString('base64'),
    branch,
    ...(sha ? { sha } : {}),
  });
}

/** Branch off the default branch's head, then open the PR. Re-runs reuse the branch. */
function openSetupPr(repo: string, base: string, content: string): string {
  const head = ghApi<{ object: { sha: string } }>(`repos/${repo}/git/ref/heads/${base}`).object.sha;
  try {
    ghApi(`repos/${repo}/git/refs`, 'POST', { ref: `refs/heads/${SETUP_BRANCH}`, sha: head });
  } catch {
    ghApi(`repos/${repo}/git/refs/heads/${SETUP_BRANCH}`, 'PATCH', { sha: head, force: true });
  }
  putWorkflow(repo, SETUP_BRANCH, content, existingSha(repo, SETUP_BRANCH));
  const res = run('gh', [
    'pr',
    'create',
    '--repo',
    repo,
    '--base',
    base,
    '--head',
    SETUP_BRANCH,
    '--title',
    COMMIT_MESSAGE,
    '--body',
    'Adds the lurq upgrade autopilot. Merge to turn it on; delete the file to turn it off. https://lurq.run/docs/autopilot',
  ]);
  if (res.status !== 0) throw new Error(errorText(res));
  return res.stdout.trim();
}

function existingSha(repo: string, branch: string): string | undefined {
  try {
    return ghApi<{ sha: string }>(`repos/${repo}/contents/${WORKFLOW_PATH}?ref=${branch}`).sha;
  } catch {
    return undefined; // 404: not there yet
  }
}

/**
 * Can this repository's Actions open a pull request at all?
 *
 * Off by default on every new repository, and with it off the job runs to the
 * end, commits its branch, and dies at the last step with "GitHub Actions is
 * not permitted to create or approve pull requests" — having done all the work
 * and produced nothing anyone will see. Three of the first nine repositories
 * set up with this command failed exactly there.
 *
 * Checked, not changed. The setting applies to every workflow in the
 * repository rather than to this one, so turning it on is the user's call:
 * `--allow-pr-creation` does it, and without that this returns the one-line
 * remedy for the summary. A read that fails says nothing rather than guessing.
 */
function pullRequestPermission(repo: string, fix: boolean): string | null {
  const path = `repos/${repo}/actions/permissions/workflow`;
  try {
    const current = ghApi<{
      default_workflow_permissions: string;
      can_approve_pull_request_reviews: boolean;
    }>(path);
    if (current.can_approve_pull_request_reviews) return null;
    if (!fix) {
      return `Actions may not open pull requests here, so runs will stop at their branch. Turn it on in Settings → Actions → General, or: gh api -X PUT ${path} -F can_approve_pull_request_reviews=true -f default_workflow_permissions=${current.default_workflow_permissions}`;
    }
    // Sent back with the repository's existing default_workflow_permissions
    // rather than a value of ours: this call replaces both fields, and the
    // other one is their choice about what every workflow's token may do.
    ghApi(path, 'PUT', { ...current, can_approve_pull_request_reviews: true });
    return 'allowed Actions to open pull requests';
  } catch {
    return null;
  }
}

/**
 * One repository, end to end: secret, workflow, first run.
 *
 * Never throws — a failure on one repo is a row in the summary, not the end of
 * the other twenty-nine.
 */
function initRepo(
  repo: string,
  mode: InitMode,
  secrets: Record<string, string>,
  opts: InitOptions,
): RepoResult {
  try {
    // A mode asked for on the command line has to actually govern. The file's
    // baked mode is only a fallback — the workflow resolves the dashboard's
    // setting at run time — so without this, `--mode fix` on a repo the
    // dashboard has set to `pr` silently runs as `pr`. The repository variable
    // is the documented way to be explicit, it is visible in repo settings, and
    // deleting it hands the repo back to the dashboard.
    if (opts.mode) {
      const res = run('gh', ['variable', 'set', 'LURQ_MODE', '--body', mode, '--repo', repo]);
      if (res.status !== 0) return { repo, outcome: 'failed', detail: errorText(res) };
    }
    for (const [name, value] of Object.entries(secrets)) {
      const err = setSecret(repo, name, value);
      if (err) return { repo, outcome: 'failed', detail: err };
    }

    const permission = pullRequestPermission(repo, opts.allowPrCreation === true);

    const base = ghApi<{ default_branch: string }>(`repos/${repo}`).default_branch;
    const sha = existingSha(repo, base);
    if (sha && !opts.force) {
      return {
        repo,
        outcome: 'exists',
        detail: 'workflow already committed (--force replaces it)',
      };
    }

    // The root listing is what the dashboard reads too: a nested lockfile is a workspace's.
    const root = ghApi<{ name: string }[]>(`repos/${repo}/contents/?ref=${base}`).map(
      (e) => e.name,
    );
    const content = renderWorkflow({
      mode,
      installCommand: detectInstallCommand(LOCKFILES.filter((f) => root.includes(f))),
    });

    if (!opts.pr) {
      try {
        putWorkflow(repo, base, content, sha);
        // Starts the first run now rather than up to a week from now. A just-
        // committed workflow can take a moment to register, so a failure here
        // is a note, not a failed repo: the schedule still picks it up.
        const started = run('gh', ['workflow', 'run', WORKFLOW_FILE, '--repo', repo]);
        return {
          repo,
          outcome: 'committed',
          started: started.status === 0,
          detail: [
            started.status === 0 ? 'first run started' : 'first run starts on schedule',
            permission,
          ]
            .filter(Boolean)
            .join('\n    '),
        };
      } catch {
        // Protected default branch or a ruleset: fall through to a pull request.
      }
    }
    return {
      repo,
      outcome: 'pull-request',
      detail: [openSetupPr(repo, base, content), permission].filter(Boolean).join('\n    '),
    };
  } catch (err) {
    return { repo, outcome: 'failed', detail: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * Follow the runs this command started, and say how they ended.
 *
 * Setup that reports success for a run that fails a minute later is worse than
 * setup that reports nothing: the first nine repositories this was used on all
 * printed a tick and then failed at the same step, and nothing on the terminal
 * said so. The command that set them up is the right place to find out.
 *
 * Bounded and best-effort — a run still going when the budget runs out is
 * reported as still going, not as a failure.
 */
async function watchRuns(repos: string[]): Promise<void> {
  const deadline = Date.now() + WATCH_BUDGET_MS;
  const pending = new Set(repos);
  logger.info(`\n${dim(`watching the first run on ${pending.size}…`)}`);

  while (pending.size > 0 && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 10_000));
    for (const repo of [...pending]) {
      const res = run('gh', [
        'run',
        'list',
        '--repo',
        repo,
        '--workflow',
        WORKFLOW_FILE,
        '-L',
        '1',
        '--json',
        'status,conclusion,databaseId,url',
      ]);
      if (res.status !== 0) {
        pending.delete(repo);
        continue;
      }
      const [run0] = JSON.parse(res.stdout || '[]') as {
        status: string;
        conclusion: string | null;
        databaseId: number;
        url: string;
      }[];
      if (!run0 || run0.status !== 'completed') continue;
      pending.delete(repo);
      if (run0.conclusion === 'success') {
        logger.info(`${green('✓')} ${repo}${dim('  run passed')}`);
      } else {
        logger.info(
          `${red('✗')} ${repo}  run ${run0.conclusion}${failedStep(repo, run0.databaseId)}`,
        );
        logger.info(`  ${dim(run0.url)}`);
        process.exitCode = 1;
      }
    }
  }
  for (const repo of pending) logger.info(`${dim('·')} ${repo}${dim('  run still going')}`);
}

/** The name of the step that failed, which is the whole diagnosis most of the time. */
function failedStep(repo: string, id: number): string {
  const res = run('gh', [
    'run',
    'view',
    String(id),
    '--repo',
    repo,
    '--json',
    'jobs',
    '--jq',
    '[.jobs[].steps[] | select(.conclusion == "failure") | .name] | first // ""',
  ]);
  const name = res.status === 0 ? res.stdout.trim() : '';
  return name ? ` at "${name}"` : '';
}

export async function runAutopilotInit(opts: InitOptions): Promise<void> {
  const mode = parseMode(opts.mode);

  // 1. Which repositories. Named ones, else this checkout's origin.
  let repos = (opts.repo ?? []).map((r) => r.trim()).filter(Boolean);
  if (repos.length === 0) {
    const remote = run('git', ['remote', 'get-url', 'origin'], undefined, opts.cwd);
    const here = remote.status === 0 ? parseRepoFromRemote(remote.stdout) : null;
    if (here) repos = [here];
  }
  if (repos.length === 0) {
    logger.error('Could not work out which repository this is.');
    logger.error('Pass one or more: lurq autopilot init --repo owner/a owner/b');
    process.exitCode = 1;
    return;
  }

  // 2. The key that lets the workflow ask lurq what is outstanding.
  const apiKey = resolveApiKey(opts.apiKey);
  if (!apiKey) {
    logger.error(
      'No lurq API key on this machine. Run `npx lurqrun setup` first, then this again.',
    );
    process.exitCode = 1;
    return;
  }

  // 3. gh, which is how every write here happens — under the user's own auth.
  if (!have('gh')) {
    logger.error('The GitHub CLI (`gh`) is not installed. https://cli.github.com');
    process.exitCode = 1;
    return;
  }
  const auth = run('gh', ['auth', 'status']);
  if (auth.status !== 0) {
    logger.error('`gh` is not signed in. Run `gh auth login`, then this again.');
    process.exitCode = 1;
    return;
  }
  if (missingWorkflowScope(`${auth.stdout}\n${auth.stderr}`)) {
    logger.error(
      'GitHub only lets a token write workflow files with the `workflow` scope. Add it:',
    );
    logger.error('    gh auth refresh -s workflow');
    process.exitCode = 1;
    return;
  }

  // 4. Secrets, gathered once and set on every repo.
  const secrets: Record<string, string> = { LURQ_API_KEY: apiKey };
  const notes: string[] = [];
  if (needsAgentCredential(mode) && opts.credential !== false) {
    const token = have('claude')
      ? (logger.info(dim('Minting a Claude token — sign in when prompted.')), mintClaudeToken())
      : null;
    if (token) {
      secrets.CLAUDE_CODE_OAUTH_TOKEN = token;
      notes.push(
        `${yellow('The Claude token expires one year from today, with no warning.')} An ANTHROPIC_API_KEY does not:\n` +
          '    gh secret set ANTHROPIC_API_KEY --repo <owner/name>',
      );
    } else {
      notes.push(
        'pr mode needs an Anthropic credential and none was set. Per repo:\n' +
          '    gh secret set ANTHROPIC_API_KEY --repo <owner/name>',
      );
    }
  }

  if (!opts.json)
    logger.info(
      `${bold('mode')} ${mode} · ${repos.length} ${repos.length === 1 ? 'repository' : 'repositories'}\n`,
    );

  // 5. Sequential: gh shares one rate limit, and the output reads in order.
  const results: RepoResult[] = [];
  for (const repo of repos) {
    const result = initRepo(repo, mode, secrets, opts);
    results.push(result);
    if (!opts.json)
      logger.info(`${resultMark(result)} ${repo}${result.detail ? dim(`  ${result.detail}`) : ''}`);
  }

  if (results.some((r) => r.outcome === 'failed')) process.exitCode = 1;

  // The runs, not just the commits. Skipped for --json, which is read by
  // callers that want the setup result rather than a live progress feed.
  const watching = results.filter((r) => r.started).map((r) => r.repo);
  if (!opts.json && opts.watch !== false && watching.length > 0) await watchRuns(watching);

  if (opts.json) {
    logger.info(JSON.stringify({ mode, results }, null, 2));
    return;
  }
  if (results.some((r) => r.outcome === 'pull-request')) {
    notes.push('Merge the pull requests above to turn those repositories on.');
  }
  if (results.some((r) => r.outcome === 'committed') && !opts.repo?.length) {
    notes.push('Committed on GitHub, not locally: `git pull` to see it in this checkout.');
  }
  for (const note of notes) logger.info(`\n  · ${note}`);
}

function resultMark(r: RepoResult): string {
  if (r.outcome === 'failed') return red('✗');
  if (r.outcome === 'pull-request') return yellow('↗');
  if (r.outcome === 'exists') return dim('·');
  return green('✓');
}
