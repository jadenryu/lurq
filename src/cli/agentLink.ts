/**
 * Setup from an agent's shell: hand the user one link, and finish without them.
 *
 * An agent can run a command but cannot sign a person up, and until now that
 * was where it stopped. `lurq setup` needs a terminal for its prompts, `--yes`
 * needs a key the agent does not have, and the 401 an agent sees says to run the
 * very command that then refused. The browser handoff (browserAuth.ts) never
 * needed a terminal, only a process still listening when the person signs in.
 *
 * So the command splits in two. The part the agent runs starts a detached copy
 * of itself, reads the sign-in link that copy prints, and exits straight away
 * with it: an agent's shell tool hands back output only when the command ends,
 * so a command that waited on a person would time out before the agent ever saw
 * the link. The detached copy holds the loopback listener, and once the person
 * signs in it validates the key and connects every detected agent, exactly as
 * `--yes` does.
 *
 * Local agents only: the listener is on 127.0.0.1, so the sign-in has to happen
 * on the machine the agent runs on. A cloud or SSH agent still needs `--api-key`.
 * ponytail: loopback, not a device-code flow; add one when remote agents matter.
 */
import { spawn, type ChildProcess, type SpawnOptions } from 'node:child_process';

/** The detached copy prints the link on a line starting with this, before anything else it says. */
export const LINK_PREFIX = 'LURQ_SIGNIN ';

/** How long the detached copy waits for the sign-in. Long enough to find the link in a chat, short enough not to linger. */
export const LINK_WAIT_MS = 15 * 60_000;

/** How long the agent's command waits for the detached copy to produce a link. */
const START_TIMEOUT_MS = 15_000;

export type SetupMode = 'interactive' | 'non-interactive' | 'agent-link' | 'needs-key';

/**
 * Which way a `setup` run goes.
 *
 * - A terminal, without `--yes`: the wizard.
 * - `--yes`, or no terminal but a key already on hand: configure without asking.
 *   An agent re-running setup to add an editor should not be sent to sign in again.
 * - No terminal and no key: the link flow, unless nobody could open it (CI) or
 *   our dashboard cannot issue the key (a self-hosted endpoint).
 */
export function setupMode(o: {
  yes: boolean;
  tty: boolean;
  ci: boolean;
  hasKey: boolean;
  selfHosted: boolean;
}): SetupMode {
  if (o.yes) return o.hasKey ? 'non-interactive' : 'needs-key';
  if (o.tty) return 'interactive';
  if (o.hasKey) return 'non-interactive';
  return o.ci || o.selfHosted ? 'needs-key' : 'agent-link';
}

type Spawn = (command: string, args: string[], options: SpawnOptions) => ChildProcess;

/**
 * Start the detached copy and return the sign-in link it prints, or null when it
 * could not produce one (it exited, or said nothing in time).
 */
export function startAgentLink(
  opts: { agent?: string; noOpen?: boolean },
  spawnImpl: Spawn = spawn,
): Promise<string | null> {
  // execArgv carries a loader (tsx in development) that the entry needs to run at all.
  const args = [...process.execArgv, process.argv[1] ?? '', 'setup', '--wait-for-signin'];
  if (opts.agent) args.push('--agent', opts.agent);
  if (opts.noOpen) args.push('--no-open');

  const child = spawnImpl(process.execPath, args, {
    detached: true,
    stdio: ['ignore', 'pipe', 'ignore'],
    // The link has to be the first thing it prints; an update notice first would only be noise.
    env: { ...process.env, NO_UPDATE_NOTIFIER: '1' },
  });

  return new Promise((resolve) => {
    let buffered = '';
    const done = (link: string | null) => {
      clearTimeout(timer);
      child.stdout?.removeAllListeners('data');
      // Let go of the child: this process exits now, the copy keeps waiting.
      child.stdout?.destroy();
      child.unref();
      resolve(link);
    };
    const timer = setTimeout(() => done(null), START_TIMEOUT_MS);
    child.stdout?.on('data', (chunk: Buffer | string) => {
      buffered += chunk.toString();
      const line = buffered.split('\n').find((l) => l.startsWith(LINK_PREFIX));
      if (line) done(line.slice(LINK_PREFIX.length).trim());
    });
    child.once('error', () => done(null));
    child.once('exit', () => done(null));
  });
}
