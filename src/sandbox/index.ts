/**
 * Sandbox driver selection. With E2B_API_KEY set, the VM-isolated E2B driver is
 * used (safe for untrusted packages); otherwise the local child-process driver
 * (trusted packages only). The E2B module is imported lazily so its heavy SDK
 * never loads on the CLI/install path when isolation isn't configured.
 */
import { getConfig } from '../core/config';
import { LocalSandbox } from './local';
import type { Sandbox } from './types';

export async function getSandbox(): Promise<Sandbox> {
  if (getConfig().E2B_API_KEY) {
    const { E2BSandbox } = await import('./e2b');
    return new E2BSandbox();
  }
  return new LocalSandbox();
}

export * from './types';
export { LocalSandbox, npmInstallArgs, smokeScript } from './local';
