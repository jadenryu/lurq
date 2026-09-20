/**
 * Keeps lurq's agent hooks installed and current without the user re-running
 * `lurq setup`: someone who set lurq up before hooks existed gets them, and a
 * Cursor hook pointing at a lurq binary that moved gets the new path.
 *
 * It rides on any `lurq` run, including the hook runs themselves, which fire all
 * day, and does real work at most once a day.
 *
 * What it will not do is decide for the user:
 *   - only agents whose config already holds setup's lurq MCP entry get hooks;
 *   - once lurq has installed an agent's hooks, their absence means the user took
 *     them out, and they stay out;
 *   - `LURQ_NO_AUTO_HOOKS=1`, or `"autoHooks": false` in ~/.lurq/config.json, turns
 *     it off;
 *   - Codex's own /hooks review is left to the user. It is a security prompt.
 *
 * It never writes to stdout (hooks answer in JSON there) and never throws.
 */
import { mkdirSync, statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { readUserConfig, resolveApiKey } from '../core/userConfig';
import type { HookAgent } from './hook';

const DAY_MS = 24 * 60 * 60 * 1000;

/** Commands that manage lurq's files themselves, or run a server rather than a user's machine. */
const SKIP = new Set(['setup', 'uninstall', 'logout', 'install-skill', 'serve-http']);

export interface AgentHookState {
  agent: HookAgent;
  /** Setup's lurq MCP entry is in the agent's config. */
  hasEntry: boolean;
  /** lurq's hooks are in the agent's hooks file. */
  hooksPresent: boolean;
  /** The command lurq recorded writing, when it has installed this agent's hooks before. */
  recorded?: string;
  /** The command it would write today. */
  current: string;
}

export interface HookAction {
  agent: HookAgent;
  kind: 'install' | 'refresh';
}

/** What to change, from what is on disk. Pure. */
export function planHookMaintenance(states: AgentHookState[]): HookAction[] {
  return states.flatMap((s): HookAction[] => {
    if (!s.hasEntry) return [];
    if (s.recorded === undefined)
      return [{ agent: s.agent, kind: s.hooksPresent ? 'refresh' : 'install' }];
    if (!s.hooksPresent) return []; // Removed by the user.
    return s.recorded === s.current ? [] : [{ agent: s.agent, kind: 'refresh' }];
  });
}

function stampPath(): string {
  return join(process.env.XDG_CACHE_HOME || join(homedir(), '.cache'), 'lurq', 'hooks-check');
}

export async function maintainHooks(argv: string[], now = Date.now()): Promise<void> {
  try {
    if (SKIP.has(argv[0] ?? '') || process.env.LURQ_NO_AUTO_HOOKS === '1') return;
    const stamp = stampPath();
    try {
      if (now - statSync(stamp).mtimeMs < DAY_MS) return;
    } catch {
      // Never checked on this machine.
    }
    const config = readUserConfig();
    // No key: setup never ran here, so there is nothing to keep current.
    if (config.autoHooks === false || !resolveApiKey()) return;
    // Stamped before the work, so a burst of hook runs does it once.
    mkdirSync(join(stamp, '..'), { recursive: true });
    writeFileSync(stamp, '');

    const skill = await import('./installSkill');
    const invocation = skill.lurqInvocation();
    if (!invocation.onPath) return;
    const states = skill.agentSpecs().flatMap((spec): AgentHookState[] => {
      const agent = skill.hookAgentFor(spec.id);
      if (!agent) return [];
      try {
        return [
          {
            agent,
            hasEntry: skill.hasLurqEntry(spec),
            hooksPresent: skill.hasLurqHooks(skill.readJsonObject(skill.hooksPath(agent))),
            recorded: config.hooks?.[agent]?.command,
            current: skill.lurqCommandFor(agent, invocation),
          },
        ];
      } catch {
        return []; // A hooks file that is not plain JSON is the user's to fix, not ours to overwrite.
      }
    });

    const added: HookAgent[] = [];
    for (const action of planHookMaintenance(states)) {
      try {
        if (skill.installHooks(action.agent, undefined, invocation) && action.kind === 'install')
          added.push(action.agent);
      } catch {
        // One unwritable file must not stop the others.
      }
    }
    if (added.length && process.stderr.isTTY) {
      const names = added.map((a) => skill.hooksLabel(a).replace(/ hooks$/, '')).join(', ');
      process.stderr.write(
        `lurq: turned on install checks for ${names}.${added.includes('codex') ? ' In Codex, run /hooks once to trust them.' : ''} Turn this off with LURQ_NO_AUTO_HOOKS=1.\n`,
      );
    }
  } catch {
    // Automatic upkeep never breaks the command the user ran.
  }
}
