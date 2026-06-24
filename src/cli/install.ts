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

/** Lightweight MCP `tools/list` ping to confirm the key authenticates. */
async function validateKey(url: string, apiKey: string): Promise<boolean> {
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
    return res.ok;
  } catch {
    return false;
  }
}

export async function runInstallWizard(opts: WizardOptions): Promise<void> {
  const interactive = !opts.yes;
  const url = opts.url ?? process.env.LURQ_ENDPOINT ?? DEFAULT_ENDPOINT;
  let apiKey = (opts.apiKey ?? process.env.LURQ_API_KEY)?.trim();

  if (interactive) {
    const { input, checkbox, confirm } = await import('@inquirer/prompts');

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
    const ok = await validateKey(url, apiKey);
    console.log(ok ? 'ok' : 'could not reach endpoint');
    if (!ok) {
      const proceed = await confirm({
        message: `Couldn't validate the key against ${url}. Continue anyway?`,
        default: false,
      });
      if (!proceed) {
        console.log('Aborted. No config was changed.');
        return;
      }
    }

    let selected: AgentSpec[];
    if (opts.agent) {
      selected = resolveAgents(opts.agent);
    } else {
      const specs = agentSpecs();
      const ids = await checkbox({
        message: 'Which assistant(s) should I configure?',
        choices: specs.map((s) => ({
          name: `${s.label}${s.detected ? ' (detected)' : ''}`,
          value: s.id,
          checked: s.detected,
        })),
      });
      selected = specs.filter((s) => ids.includes(s.id));
    }
    await finish(selected, { url, apiKey });
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
