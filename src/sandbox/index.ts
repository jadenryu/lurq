/**
 * Sandbox driver selection. Local by default; this is the one place to swap in a
 * VM-isolated driver (E2B / Firecracker) once the infra is provisioned — e.g.
 * keyed off an env/config flag — without touching any caller.
 */
import { LocalSandbox } from './local';
import type { Sandbox } from './types';

export function getSandbox(): Sandbox {
  return new LocalSandbox();
}

export * from './types';
export { LocalSandbox, npmInstallArgs, smokeScript } from './local';
