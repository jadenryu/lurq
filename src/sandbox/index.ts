/**
 * Sandbox driver selection. With E2B_API_KEY set, the VM-isolated E2B driver is
 * used (safe for untrusted packages); otherwise the local child-process driver
 * (trusted packages only). The E2B module is imported lazily so its heavy SDK
 * never loads on the CLI/install path when isolation isn't configured.
 *
 * The fallback is the dangerous part, and it used to be silent. A caller that
 * installs and imports an arbitrary npm package — which is what probing an MCP
 * server is — got VM isolation or the local child-process driver depending on
 * whether an environment variable happened to be set, with no error either way.
 * Forgetting E2B_API_KEY in production therefore meant executing untrusted
 * third-party code inside the service container, and nothing said so.
 *
 * So callers that run untrusted code now ask for isolation explicitly and are
 * refused when it is unavailable. Opting out is possible, but it has to be
 * typed out: LURQ_ALLOW_LOCAL_SANDBOX=1, for a laptop with no E2B account.
 */
import { getConfig } from '../core/config';
import { LocalSandbox } from './local';
import type { Sandbox } from './types';

/** Refusal to run untrusted code without VM isolation. Never a verdict about the subject. */
export class SandboxIsolationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SandboxIsolationError';
  }
}

/** The env opt-out, read in one place so the tests and the gate cannot disagree. */
export const localSandboxAllowed = (env: NodeJS.ProcessEnv = process.env): boolean =>
  env.LURQ_ALLOW_LOCAL_SANDBOX === '1';

/**
 * Is a driver that may run untrusted code available? Pure, so it is testable
 * without mutating the environment, and so the pipeline can ask the question
 * BEFORE it claims any work — a config mistake must not consume queue attempts.
 */
export function isolationGate(opts: { hasE2BKey: boolean; allowLocal: boolean }):
  | { ok: true; driver: 'e2b' | 'local' }
  | { ok: false; reason: string } {
  if (opts.hasE2BKey) return { ok: true, driver: 'e2b' };
  if (opts.allowLocal) return { ok: true, driver: 'local' };
  return {
    ok: false,
    reason:
      'no VM isolation available: E2B_API_KEY is not set, so this would install and import an untrusted package in this process\'s own container. Set E2B_API_KEY, or set LURQ_ALLOW_LOCAL_SANDBOX=1 to accept local execution deliberately.',
  };
}

/** True when an isolated driver is configured. Cheap; no SDK load. */
export const isolationAvailable = (env?: NodeJS.ProcessEnv): boolean =>
  isolationGate({ hasE2BKey: Boolean(getConfig().E2B_API_KEY), allowLocal: localSandboxAllowed(env) }).ok;

export async function getSandbox(opts: { isolated?: boolean } = {}): Promise<Sandbox> {
  const hasE2BKey = Boolean(getConfig().E2B_API_KEY);
  if (opts.isolated) {
    const gate = isolationGate({ hasE2BKey, allowLocal: localSandboxAllowed() });
    if (!gate.ok) throw new SandboxIsolationError(gate.reason);
  }
  if (hasE2BKey) {
    const { E2BSandbox } = await import('./e2b');
    return new E2BSandbox();
  }
  return new LocalSandbox();
}

export * from './types';
export { LocalSandbox, npmInstallArgs, smokeScript } from './local';
