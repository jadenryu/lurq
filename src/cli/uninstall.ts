/**
 * `lurq uninstall`: take back what `lurq setup` wrote, and nothing else.
 *
 * Setup writes to files that mostly belong to someone else: an agent's MCP
 * config (`~/.claude.json` is Claude Code's whole state), Codex's TOML, a rules
 * file the user writes in too. So removal is surgical: the `lurq` key in a JSON
 * config, the `[mcp_servers.lurq]` table in TOML, the marked block in a shared
 * rules file. A file is deleted only when it was ours outright (the Claude skill,
 * the Kiro steering file, ~/.lurq/*), or when taking our block out left it empty.
 *
 * Planned first, applied second, so the user sees the exact list before
 * anything changes, and `--yes` skips only the question, never the list.
 */
import { existsSync, readdirSync, readFileSync, rmdirSync, rmSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { KEYS_URL, PACKAGE_NAME } from '../core/constants';
import { clearUserConfig, lurqHome, userConfigPath } from '../core/userConfig';
import { dim, green, red, yellow } from './format';
import {
  agentSpecs,
  BLOCK_START,
  readJsonObject,
  removeMarkedBlock,
  resolveAgents,
  stripTomlBlock,
  writeFileAtomic,
  writeJson,
  type AgentSpec,
} from './installSkill';

export interface Removal {
  label: string;
  path: string;
  apply: () => void;
}

/** Delete a directory only if nothing else lives in it. */
function removeDirIfEmpty(dir: string): void {
  if (existsSync(dir) && readdirSync(dir).length === 0) rmdirSync(dir);
}

/** Write `text` back, or delete the file when our part was all there was. */
function rewriteOrRemove(path: string, text: string): void {
  if (text.trim()) writeFileAtomic(path, text);
  else rmSync(path, { force: true });
}

function mcpEntryRemoval(spec: AgentSpec): Removal | null {
  if (!existsSync(spec.path)) return null;
  const label = `${spec.label} MCP entry`;

  if (spec.format === 'toml') {
    if (!readFileSync(spec.path, 'utf8').includes('[mcp_servers.lurq]')) return null;
    return {
      label,
      path: spec.path,
      apply: () => {
        const stripped = stripTomlBlock(readFileSync(spec.path, 'utf8')).replace(/\s+$/, '');
        rewriteOrRemove(spec.path, stripped ? `${stripped}\n` : '');
      },
    };
  }

  const key = spec.format === 'servers' ? 'servers' : 'mcpServers';
  const servers = readJsonObject(spec.path)[key];
  if (!servers || typeof servers !== 'object' || !Object.hasOwn(servers, 'lurq')) return null;
  return {
    label,
    path: spec.path,
    // Re-read at apply time: the agent may have rewritten its config while the
    // user was reading the list.
    apply: () => {
      const config = readJsonObject(spec.path);
      delete config[key].lurq;
      writeJson(spec.path, config);
    },
  };
}

function instructionsRemoval(spec: AgentSpec): Removal | null {
  const target = spec.instructions;
  if (!target || !existsSync(target.path)) return null;

  if (target.kind === 'shared') {
    if (!readFileSync(target.path, 'utf8').includes(BLOCK_START)) return null;
    return {
      label: `${spec.label} instructions block`,
      path: target.path,
      apply: () => rewriteOrRemove(target.path, removeMarkedBlock(readFileSync(target.path, 'utf8'))),
    };
  }

  return {
    label: `${spec.label} ${target.kind === 'skill' ? 'skill' : 'steering file'}`,
    path: target.path,
    apply: () => {
      rmSync(target.path, { force: true });
      // ~/.claude/skills/lurq/ exists only to hold the skill.
      if (target.kind === 'skill') removeDirIfEmpty(dirname(target.path));
    },
  };
}

/**
 * Everything to remove for these agents, plus lurq's own files when `global`.
 * Unreadable configs are reported, not fatal: one hand-broken file must not
 * stop the rest of the uninstall.
 */
export function planUninstall(
  specs: AgentSpec[],
  opts: { global: boolean },
): { removals: Removal[]; problems: string[] } {
  const removals: Removal[] = [];
  const problems: string[] = [];
  const seen = new Set<string>();
  const add = (r: Removal | null) => {
    // By path: Gemini CLI and Antigravity share GEMINI.md, one block to remove.
    // Every other target (each config, each ours-alone file) is its own path.
    if (!r || seen.has(r.path)) return;
    seen.add(r.path);
    removals.push(r);
  };

  for (const spec of specs) {
    try {
      add(mcpEntryRemoval(spec));
    } catch (err) {
      problems.push(`${spec.label}: ${err instanceof Error ? err.message : String(err)}`);
    }
    add(instructionsRemoval(spec));
  }

  if (opts.global) {
    const guide = join(lurqHome(), 'skill-instructions.md');
    if (existsSync(guide)) {
      add({ label: 'lurq agent guide', path: guide, apply: () => rmSync(guide, { force: true }) });
    }
    if (existsSync(userConfigPath())) {
      add({
        label: 'stored API key',
        path: userConfigPath(),
        apply: () => {
          clearUserConfig();
          removeDirIfEmpty(lurqHome());
        },
      });
    }
  }
  return { removals, problems };
}

export async function runUninstall(opts: { agent?: string; yes?: boolean }): Promise<void> {
  // Every agent, not only the detected ones: an editor removed since setup still
  // has our entry in its leftover config.
  const global = !opts.agent || opts.agent === 'all';
  const specs = global ? agentSpecs() : resolveAgents(opts.agent!);
  const { removals, problems } = planUninstall(specs, { global });
  const short = (p: string) => (p.startsWith(homedir()) ? `~${p.slice(homedir().length)}` : p);

  for (const p of problems) console.log(`${yellow('!')} ${p}`);
  if (removals.length === 0) {
    console.log(`Nothing to remove: lurq is not set up ${global ? 'on this machine' : `for ${specs[0]!.label}`}.`);
    if (problems.length) process.exitCode = 1;
    return;
  }

  console.log('lurq uninstall removes:');
  for (const r of removals) console.log(`  • ${r.label.padEnd(36)} ${short(r.path)}`);
  console.log(dim('  Everything else in these files stays as it is.\n'));

  if (!opts.yes) {
    if (!(process.stdin.isTTY && process.stdout.isTTY)) {
      throw new Error('Nothing was removed. Re-run with --yes to confirm without a prompt.');
    }
    const { confirm } = await import('@inquirer/prompts');
    if (!(await confirm({ message: 'Remove these?', default: true }))) {
      console.log('Nothing was removed.');
      return;
    }
  }

  let failed = problems.length;
  for (const r of removals) {
    try {
      r.apply();
      console.log(`${green('✓')} removed ${r.label}`);
    } catch (err) {
      failed++;
      console.log(`${red('✗')} ${r.label}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  console.log('\nRestart your agents so they drop the lurq server.');
  if (global) {
    console.log(dim(`The key keeps working until you revoke it: ${KEYS_URL}`));
    console.log(dim(`To remove the \`lurq\` command as well: npm uninstall -g ${PACKAGE_NAME}`));
  }
  if (failed) process.exitCode = 1;
}
