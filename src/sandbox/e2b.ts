/**
 * E2B cloud-sandbox driver.
 *
 * Installs package(s) and smoke-loads them inside an isolated E2B microVM, so
 * top-level package code (and, with allowScripts, install hooks) runs OFF the
 * host. This is the isolation boundary the local driver deliberately lacks —
 * use it to verify UNTRUSTED packages at scale.
 *
 * Requires E2B_API_KEY. The launched template must have node + npm on PATH
 * (see E2B_TEMPLATE). Like the local driver, target.node is recorded but not
 * provisioned — pin a Node-versioned template for reproducible majors.
 */
import Sandbox from 'e2b';
import { getConfig } from '../core/config';
import {
  DEFAULT_TARGET,
  type ModuleSystem,
  type Sandbox as SandboxDriver,
  type SandboxPackage,
  type SandboxResult,
  type SandboxSetResult,
  type SandboxVerifyOptions,
} from './types';

const INSTALL_TIMEOUT_MS = 120_000;
const SMOKE_TIMEOUT_MS = 30_000;
const ERROR_MAX = 500;
const WORKDIR = '/home/user';

/** POSIX single-quote: safe for any arg (specs may carry `^`, `>`, spaces). */
export function shQuote(s: string): string {
  return `'${s.replace(/'/g, `'\\''`)}'`;
}

/** Shell command that installs the specs into WORKDIR. */
export function installCommand(specs: string[], allowScripts: boolean): string {
  const bad = specs.find((s) => s.startsWith('-'));
  if (bad) throw new Error(`Invalid package spec: ${bad}`);
  const flags = ['--no-audit', '--no-fund', '--no-package-lock', '--no-save'];
  if (!allowScripts) flags.push('--ignore-scripts');
  return `npm install ${specs.map(shQuote).join(' ')} ${flags.join(' ')}`;
}

/** Shell command that loads a package and exits non-zero if it throws. */
export function smokeCommand(pkg: string, moduleSystem: ModuleSystem): string {
  const js =
    moduleSystem === 'esm' ? `await import(${JSON.stringify(pkg)})` : `require(${JSON.stringify(pkg)})`;
  const flags = moduleSystem === 'esm' ? '--input-type=module ' : '';
  return `node ${flags}-e ${shQuote(js)}`;
}

function condense(s: string): string {
  return s.replace(/\s+/g, ' ').trim().slice(0, ERROR_MAX);
}

function errText(err: unknown): string {
  if (err && typeof err === 'object') {
    const e = err as { stderr?: unknown; message?: unknown };
    if (typeof e.stderr === 'string' && e.stderr.trim()) return e.stderr;
    if (typeof e.message === 'string') return e.message;
  }
  return String(err);
}

const toSpec = (p: SandboxPackage): string => (p.version ? `${p.name}@${p.version}` : p.name);

export class E2BSandbox implements SandboxDriver {
  readonly name = 'e2b';

  async verify(
    pkg: string,
    version: string | null,
    opts: SandboxVerifyOptions = {},
  ): Promise<SandboxResult> {
    const set = await this.verifySet([{ name: pkg, version }], opts);
    return {
      driver: this.name,
      moduleSystem: set.moduleSystem,
      installed: set.installed,
      imported: set.loaded[0]?.loaded ?? null,
      ranScripts: opts.allowScripts ?? false,
      durationMs: set.durationMs,
      error: set.error,
    };
  }

  async verifySet(
    packages: SandboxPackage[],
    opts: SandboxVerifyOptions = {},
  ): Promise<SandboxSetResult> {
    const config = getConfig();
    const target = opts.target ?? DEFAULT_TARGET;
    const allowScripts = opts.allowScripts ?? false;
    const specs = packages.map(toSpec);
    const installTimeout = opts.timeoutMs ?? INSTALL_TIMEOUT_MS;
    const started = Date.now();
    const loaded = packages.map((p) => ({ name: p.name, loaded: null as boolean | null }));
    let installed = false;
    let error: string | null = null;

    // Build install command up front so a bad spec fails before we spend a VM.
    const install = installCommand(specs, allowScripts);

    // Sandbox lifetime must outlast install + every smoke run, plus buffer.
    const createOpts = {
      apiKey: config.E2B_API_KEY,
      timeoutMs: installTimeout + SMOKE_TIMEOUT_MS * packages.length + 30_000,
    };
    const sandbox = config.E2B_TEMPLATE
      ? await Sandbox.create(config.E2B_TEMPLATE, createOpts)
      : await Sandbox.create(createOpts);

    try {
      await sandbox.files.write(
        `${WORKDIR}/package.json`,
        JSON.stringify({ name: 'lurq-sandbox', version: '0.0.0', private: true }),
      );
      await sandbox.commands.run(install, { cwd: WORKDIR, timeoutMs: installTimeout });
      installed = true;

      for (let i = 0; i < packages.length; i++) {
        try {
          await sandbox.commands.run(smokeCommand(packages[i]!.name, target.moduleSystem), {
            cwd: WORKDIR,
            timeoutMs: SMOKE_TIMEOUT_MS,
          });
          loaded[i]!.loaded = true;
        } catch (err) {
          loaded[i]!.loaded = false;
          if (!error) error = condense(errText(err));
        }
      }
    } catch (err) {
      error = condense(errText(err));
    } finally {
      await sandbox.kill().catch(() => {});
    }

    return {
      driver: this.name,
      moduleSystem: target.moduleSystem,
      installed,
      loaded,
      durationMs: Date.now() - started,
      error,
    };
  }
}
