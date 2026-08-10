/**
 * One-time machine setup (`lurq setup`, and bare `npx lurqrun`).
 *
 * The whole point of this command is that a user types one thing, `npx lurqrun`,
 * and is then done: `lurq` is on their PATH, the key is stored for the CLI
 * itself, and every detected assistant gets both an MCP entry and a
 * standing-instructions file. Nothing afterwards needs `npx`, a shell export,
 * or a second command.
 *
 * It opens the dashboard in a browser, walks the three steps in the terminal,
 * takes the pasted key, validates it against the endpoint, and writes:
 *   - `~/.lurq/config.json`: so `lurq recommend` &c. work in any directory
 *   - each agent's MCP config: a keyed HTTP entry, no DATABASE_URL anywhere
 *   - each agent's skill / rules file: so it reaches for lurq unprompted
 *
 * Fully non-interactive with `--yes` plus flags or env, for dotfiles and CI.
 */
import { spawnSync } from 'node:child_process';

import { DEFAULT_ENDPOINT, PACKAGE_NAME } from '../core/constants';
import { openInBrowser } from '../core/open';
import {
  readUserConfig,
  resolveApiKey,
  resolveEndpoint,
  writeUserConfig,
} from '../core/userConfig';
import { bold, dim, green, yellow } from './format';
import {
  agentSpecs,
  installAgent,
  installInstructionsFile,
  lurqInvocation,
  printInstallReport,
  resolveAgents,
  type AgentSpec,
  type InstallMode,
} from './installSkill';

export interface WizardOptions {
  apiKey?: string;
  url?: string;
  agent?: string;
  yes?: boolean;
  /** Skip launching a browser (headless boxes, SSH sessions, CI). */
  noOpen?: boolean;
}

/** Where a signed-in user creates a key. */
const KEYS_URL = 'https://lurq.run/dashboard/keys';

/**
 * Lightweight MCP `tools/list` ping to confirm the key authenticates.
 * Distinguishes a rejected key (401/403) from an unreachable endpoint so the
 * wizard can tell the user which one happened instead of blaming the key on a
 * flaky network.
 */
type KeyCheck = 'valid' | 'invalid' | 'unreachable';

async function validateKey(url: string, apiKey: string): Promise<KeyCheck> {
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
    });
    if (res.ok) return 'valid';
    if (res.status === 401 || res.status === 403) return 'invalid';
    return 'unreachable';
  } catch {
    return 'unreachable';
  }
}

/**
 * True when this process is running out of npm's throwaway npx cache
 * (`~/.npm/_npx/<hash>/node_modules/…`) rather than an installed copy.
 *
 * npm puts every `npx <pkg>` there, prunes it later, and leaves nothing on PATH,
 * so after the wizard exits the user would have a configured machine but no
 * `lurq` command. That is the one case worth offering a global install in.
 * Takes the URL as a parameter purely so it can be tested.
 */
export function runningFromNpx(moduleUrl: string = import.meta.url): boolean {
  // File URLs are slash-separated on every platform, Windows included.
  return moduleUrl.includes('/_npx/');
}

/**
 * Put `lurq` on PATH. Never fatal: the wizard's real work is the key and the
 * agent configs, and neither depends on this succeeding. A system-managed node
 * hands out EACCES here, and the right answer to that is a printed hint rather
 * than a dead setup: the user can keep using `npx lurqrun` in the meantime.
 */
function installGlobally(): void {
  process.stdout.write(`  Installing ${PACKAGE_NAME} globally… `);
  const res = spawnSync('npm', ['install', '--global', `${PACKAGE_NAME}@latest`], {
    stdio: ['ignore', 'ignore', 'pipe'],
    encoding: 'utf8',
    // npm is a .cmd shim on Windows, which is not directly executable.
    shell: process.platform === 'win32',
  });

  if (res.status === 0) {
    console.log(green('ok'));
    console.log(dim('  `lurq` now works in any terminal, no npx needed.'));
    return;
  }

  console.log(yellow('skipped'));
  const reason = (res.stderr || res.error?.message || '').trim().split('\n').pop();
  if (reason) console.log(dim(`  ${reason}`));
  console.log(dim(`  Setup continues. Run \`npm install -g ${PACKAGE_NAME}\` later if you want it.`));
}

export async function runSetup(opts: WizardOptions): Promise<void> {
  const interactive = !opts.yes;
  // Both of these fall back to what an earlier run stored, so re-running setup
  // to add a newly-installed editor neither asks for the key again nor quietly
  // moves a self-hoster off their own endpoint and back onto ours.
  const url = resolveEndpoint(opts.url) ?? DEFAULT_ENDPOINT;
  let apiKey = resolveApiKey(opts.apiKey);
  const selfHosted = url !== DEFAULT_ENDPOINT;

  if (interactive) {
    const { input, checkbox, confirm, select } = await import('@inquirer/prompts');

    console.log(`\n  ${bold('lurq setup')}: connect this machine to the package index.\n`);
    // Always say which index, so a self-hoster can see at a glance that a
    // re-run did not quietly move them back onto the shared service.
    console.log(`  Endpoint: ${url}${selfHosted ? dim('  (your own server)') : ''}\n`);

    // Straight from npx: nothing was installed, so offer to put the command on
    // PATH first, while the user is still at the keyboard. Asked rather than
    // done silently, because it writes outside their project.
    if (runningFromNpx()) {
      const goGlobal = await confirm({
        message: `Install ${PACKAGE_NAME} globally, so \`lurq\` works without npx?`,
        default: true,
      });
      if (goGlobal) installGlobally();
      console.log('');
    }

    if (apiKey && !opts.apiKey) {
      const stored = readUserConfig().apiKey === apiKey;
      const reuse = await confirm({
        message: `Use the API key already configured${stored ? ' on this machine' : ' in your environment'}?`,
        default: true,
      });
      if (!reuse) apiKey = undefined;
    }

    if (!apiKey) {
      if (selfHosted) {
        // Sending them to our dashboard would hand them a key their own server
        // has never issued and cannot validate.
        console.log(`  Issue a key on the machine running ${url}:\n`);
        console.log(`    ${bold('lurq keys create --label my-laptop')}\n`);
        console.log('  Then paste it below.\n');
      } else {
        if (!opts.noOpen) {
          console.log(`  Opening ${KEYS_URL}\n`);
          openInBrowser(KEYS_URL);
        } else {
          console.log(`  Open ${KEYS_URL}\n`);
        }
        console.log('  1. Sign in, or create an account. It takes a moment.');
        console.log('  2. Create an API key and copy it.');
        console.log('  3. Paste it below.\n');
      }
      apiKey = (
        await input({
          message: 'Paste your lurq API key',
          validate: (v) =>
            v.trim().startsWith('lurq_') ? true : 'Keys look like lurq_live_… ',
        })
      ).trim();
    }

    process.stdout.write('  Validating key… ');
    const check = await validateKey(url, apiKey);
    console.log(
      check === 'valid' ? green('ok') : check === 'invalid' ? yellow('rejected') : yellow('could not reach endpoint'),
    );
    if (check !== 'valid') {
      const proceed = await confirm({
        message:
          check === 'invalid'
            ? `That key was rejected (401) by ${url}. Continue anyway?`
            : `Couldn't reach ${url} to validate the key. Continue anyway?`,
        default: false,
      });
      if (!proceed) {
        console.log('Aborted. No config was changed.');
        return;
      }
    }

    if (opts.agent) {
      await finish(resolveAgents(opts.agent), { url, apiKey });
      return;
    }

    const specs = agentSpecs();
    // Natural-language quick path: if we spot likely agents, offer a one-tap
    // connect before falling back to the full multi-select. "Yes" wires up EVERY
    // detected agent (the prior multi-select pre-checked them all), so a user
    // with two editors doesn't silently leave one unconnected.
    const detected = specs.filter((s) => s.detected);
    const primary = detected.find((s) => s.id === 'claude-code') ?? detected[0];
    if (primary) {
      const others = detected.length - 1;
      const choice = await select({
        message:
          others > 0
            ? `Looks like you have ${detected.map((s) => s.label).join(', ')}. Connect lurq to them?`
            : `Looks like you have ${primary.label}. Connect lurq to it?`,
        default: 'yes',
        choices: [
          {
            name: others > 0 ? `Yes, set up all ${detected.length} detected agents` : `Yes, set up ${primary.label} for me`,
            value: 'yes',
          },
          { name: 'No, let me choose which agent(s)', value: 'other' },
          { name: 'Cancel, change nothing', value: 'cancel' },
        ],
      });
      if (choice === 'cancel') {
        console.log('No problem. Nothing was changed; run `lurq setup` again anytime.');
        return;
      }
      if (choice === 'yes') {
        await finish(detected, { url, apiKey });
        return;
      }
      // 'other' falls through to the full multi-select below.
    }

    const ids = await checkbox({
      message: 'Which assistant(s) should I configure?',
      choices: specs.map((s) => ({
        name: `${s.label}${s.detected ? ' (detected)' : ''}`,
        value: s.id,
        checked: s.detected,
      })),
    });
    await finish(specs.filter((s) => ids.includes(s.id)), { url, apiKey });
    return;
  }

  // Non-interactive (--yes): require a key, use flags/env + detected agents.
  if (!apiKey) {
    throw new Error(
      'No API key. Pass --api-key <key> or set LURQ_API_KEY (or drop --yes to be prompted).',
    );
  }
  const selected = opts.agent
    ? resolveAgents(opts.agent)
    : agentSpecs().filter((s) => s.detected);
  await finish(selected, { url, apiKey });
}

/**
 * Store the credential, wire up the selected agents, and report.
 *
 * The key is saved even when no agent was selected: on a machine with no editor
 * installed yet (a fresh container, a server) the CLI itself is still the point,
 * and making the user re-paste the key later would be the wrong lesson.
 */
async function finish(
  selected: AgentSpec[],
  remote: { url: string; apiKey: string },
): Promise<void> {
  const configPath = writeUserConfig({
    apiKey: remote.apiKey,
    // Only persist a non-default endpoint. Storing the default would pin this
    // machine to today's URL and quietly ignore a later change to the built-in.
    endpoint: remote.url === DEFAULT_ENDPOINT ? undefined : remote.url,
  });
  console.log(`\n${green('✓')} API key saved to ${configPath} ${dim('(mode 0600)')}`);
  console.log(
    `${green('✓')} Pointed at ${remote.url}${
      remote.url === DEFAULT_ENDPOINT ? '' : dim('  (your own server)')
    }`,
  );
  // Named with the invocation this machine actually has. This line used to say
  // `lurq …` unconditionally, which is false for anyone who ran the wizard from
  // npx and declined (or failed) the global install: setup reports total
  // success and the very next thing they type does not exist.
  const { command } = lurqInvocation();
  console.log(
    dim(`  \`${command} recommend\`, \`evaluate\`, \`compare\`, \`verify\`, \`usage\` now work anywhere.`),
  );

  if (selected.length === 0) {
    console.log(
      '\nNo agents selected or detected. Re-run `lurq setup --agent <id>` once your assistant is installed.',
    );
    return;
  }

  const mode: InstallMode = { kind: 'remote', ...remote };
  const results = selected.map((s) => installAgent(s, mode));
  const instructionsPath = installInstructionsFile();
  console.log('');
  printInstallReport(results, instructionsPath, mode);
}
