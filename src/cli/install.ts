/**
 * Guided install wizard (`lurq install`, i.e. `npx lurqrun install`). Walks a user
 * through connecting lurq's hosted MCP service to their AI assistant(s): collects
 * the API key, optionally validates it against the endpoint, detects installed
 * agents, and writes the keyed remote config — no DATABASE_URL ever on their
 * machine. Fully non-interactive with `--yes` + flags/env for scripting.
 */
import { DEFAULT_ENDPOINT } from '../core/constants';
import {
  agentSpecs,
  installAgent,
  installInstructionsFile,
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
}

/** Where users obtain a key (operator-issued for now; self-serve dashboard later). */
const GET_KEY_URL = 'https://lurq.run';

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

export async function runInstallWizard(opts: WizardOptions): Promise<void> {
  const interactive = !opts.yes;
  const url = opts.url ?? process.env.LURQ_ENDPOINT ?? DEFAULT_ENDPOINT;
  let apiKey = (opts.apiKey ?? process.env.LURQ_API_KEY)?.trim();

  if (interactive) {
    const { input, checkbox, confirm, select } = await import('@inquirer/prompts');

    console.log('\n  lurq — connect your coding agent to the hosted package index.\n');

    if (!apiKey) {
      console.log(`  Need a key? Get one at ${GET_KEY_URL}\n`);
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
      check === 'valid' ? 'ok' : check === 'invalid' ? 'rejected' : 'could not reach endpoint',
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
    // connect before falling back to the full multi-select. Mirrors the simplified
    // "connect to Claude Code? (y/n/other)" flow in docs/lurq-demo.md. "Yes" wires
    // up EVERY detected agent (the prior multi-select pre-checked them all), so a
    // user with two editors doesn't silently leave one unconnected.
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
            name: others > 0 ? `Yes — set up all ${detected.length} detected agents` : `Yes — set up ${primary.label} for me`,
            value: 'yes',
          },
          { name: 'No — let me choose which agent(s)', value: 'other' },
          { name: 'Cancel — change nothing', value: 'cancel' },
        ],
      });
      if (choice === 'cancel') {
        console.log('No problem — nothing was changed. Run `lurq install` again anytime.');
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

async function finish(
  selected: AgentSpec[],
  remote: { url: string; apiKey: string },
): Promise<void> {
  if (selected.length === 0) {
    console.log(
      '\nNo agents selected or detected. Re-run with --agent <id>, or install an assistant first.',
    );
    return;
  }
  const mode: InstallMode = { kind: 'remote', ...remote };
  const results = selected.map((s) => installAgent(s, mode));
  const instructionsPath = installInstructionsFile();
  console.log('');
  printInstallReport(results, instructionsPath, mode);
}
