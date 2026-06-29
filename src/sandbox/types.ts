/**
 * Sandbox driver contract.
 *
 * Verification runs an install + smoke-load of a package version in an isolated
 * environment and reports whether it *actually* installs and loads — evidence no
 * static signal (downloads, stars) can provide.
 *
 * The interface is deliberately small so the runner is swappable: a local
 * child-process driver for dev/operator use, and a VM-isolated driver (E2B /
 * Firecracker / gVisor) for verifying UNTRUSTED packages at scale. Callers
 * depend only on this contract, never on a concrete driver.
 */

export type ModuleSystem = 'esm' | 'cjs';

export interface SandboxTarget {
  /** Node major the run targets. The local driver uses the host Node and just
   *  records this; a VM driver provisions it. */
  node: string;
  moduleSystem: ModuleSystem;
}

export interface SandboxVerifyOptions {
  target?: SandboxTarget;
  /** Run lifecycle install scripts (preinstall/install/postinstall). Off by
   *  default: running untrusted scripts needs VM isolation, not a bare driver. */
  allowScripts?: boolean;
  timeoutMs?: number;
  signal?: AbortSignal;
}

export interface SandboxResult {
  /** Provenance tag for the driver that produced this ('local', 'e2b', ...). */
  driver: string;
  moduleSystem: ModuleSystem;
  /** `npm install` succeeded. */
  installed: boolean;
  /** Package loaded (import/require without throwing). null = not attempted
   *  because the install failed. */
  imported: boolean | null;
  /** Whether install scripts were allowed to run for this result. */
  ranScripts: boolean;
  durationMs: number;
  /** Condensed first line(s) of the failure, if any. */
  error: string | null;
}

export interface SandboxPackage {
  name: string;
  version: string | null;
}

export interface SandboxSetResult {
  driver: string;
  moduleSystem: ModuleSystem;
  /** Co-install of the whole set succeeded. */
  installed: boolean;
  /** Per-package smoke-load (null = not attempted because the install failed). */
  loaded: { name: string; loaded: boolean | null }[];
  durationMs: number;
  error: string | null;
}

export interface Sandbox {
  /** Provenance tag stored with each result. */
  readonly name: string;
  verify(
    pkg: string,
    version: string | null,
    opts?: SandboxVerifyOptions,
  ): Promise<SandboxResult>;
  /** Co-install a set of packages and smoke-load each — the basis of the
   *  compatibility matrix. A successful co-install proves the set coexists. */
  verifySet(
    packages: SandboxPackage[],
    opts?: SandboxVerifyOptions,
  ): Promise<SandboxSetResult>;
}

export const DEFAULT_TARGET: SandboxTarget = {
  node: '20',
  moduleSystem: 'cjs',
};
