/**
 * Local child-process sandbox driver.
 *
 * Installs package(s) into a throwaway temp dir and smoke-loads them, reporting
 * whether they install and load. Fast and dependency-free (just npm + node).
 *
 * NOT an isolation boundary: loading a package executes its top-level code on
 * the host, so use this only for packages you already trust (operator/dev).
 * Verify UNTRUSTED packages with a VM driver. Install scripts stay OFF unless
 * `allowScripts` is set, since the whole point of the security tier is to not
 * execute untrusted install hooks.
 */
import { execFile } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import {
  DEFAULT_TARGET,
  type ModuleSystem,
  type Sandbox,
  type SandboxPackage,
  type SandboxResult,
  type SandboxSetResult,
  type SandboxVerifyOptions,
} from './types';

const execFileAsync = promisify(execFile);
const INSTALL_TIMEOUT_MS = 120_000;
const SMOKE_TIMEOUT_MS = 30_000;
const ERROR_MAX = 500;

/** npm args for a throwaway install of one or more specs into the sandbox dir. */
export function npmInstallArgs(specs: string[], opts: { allowScripts: boolean }): string[] {
  // A spec beginning with `-` would be parsed as an npm flag (e.g.
  // `--registry=evil`), not a package. Legitimate names/specs never start with
  // one, so reject rather than smuggle it into the install command.
  const bad = specs.find((s) => s.startsWith('-'));
  if (bad) throw new Error(`Invalid package spec: ${bad}`);
  const args = ['install', ...specs, '--no-audit', '--no-fund', '--no-package-lock', '--no-save'];
  if (!opts.allowScripts) args.push('--ignore-scripts');
  return args;
}

/** A one-liner that loads the package and exits non-zero if it throws. */
export function smokeScript(pkg: string, moduleSystem: ModuleSystem): string[] {
  return moduleSystem === 'esm'
    ? ['--input-type=module', '-e', `await import(${JSON.stringify(pkg)})`]
    : ['-e', `require(${JSON.stringify(pkg)})`];
}

function condense(s: string): string {
  return s.replace(/\s+/g, ' ').trim().slice(0, ERROR_MAX);
}

function stderrOf(err: unknown): string {
  if (err && typeof err === 'object') {
    const e = err as { stderr?: unknown; message?: unknown };
    if (typeof e.stderr === 'string' && e.stderr.trim()) return e.stderr;
    if (typeof e.message === 'string') return e.message;
  }
  return String(err);
}

const toSpec = (p: SandboxPackage): string => (p.version ? `${p.name}@${p.version}` : p.name);

export class LocalSandbox implements Sandbox {
  readonly name = 'local';

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
    const target = opts.target ?? DEFAULT_TARGET;
    const allowScripts = opts.allowScripts ?? false;
    const specs = packages.map(toSpec);
    const dir = await mkdtemp(join(tmpdir(), 'lurq-sandbox-'));
    const started = Date.now();
    const smokeTargets = opts.smokePackages ?? packages;
    const loaded = smokeTargets.map((p) => ({ name: p.name, loaded: null as boolean | null }));
    let installed = false;
    let error: string | null = null;

    try {
      await writeFile(
        join(dir, 'package.json'),
        JSON.stringify({ name: 'lurq-sandbox', version: '0.0.0', private: true }),
      );
      await execFileAsync('npm', npmInstallArgs(specs, { allowScripts }), {
        cwd: dir,
        timeout: opts.timeoutMs ?? INSTALL_TIMEOUT_MS,
        signal: opts.signal,
      });
      installed = true;

      for (let i = 0; i < smokeTargets.length; i++) {
        try {
          await execFileAsync('node', smokeScript(smokeTargets[i]!.name, target.moduleSystem), {
            cwd: dir,
            timeout: SMOKE_TIMEOUT_MS,
            signal: opts.signal,
          });
          loaded[i]!.loaded = true;
        } catch (err) {
          loaded[i]!.loaded = false;
          if (!error) error = condense(stderrOf(err));
        }
      }
    } catch (err) {
      error = condense(stderrOf(err));
    } finally {
      await rm(dir, { recursive: true, force: true }).catch(() => {});
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

  async getRuntimeInfo(): Promise<{ nodeVersion: string; npmVersion: string }> {
    let nodeVersion = 'unknown';
    let npmVersion = 'unknown';
    try {
      const nodeOut = await execFileAsync('node', ['--version']);
      nodeVersion = nodeOut.stdout.trim() || 'unknown';
      const npmOut = await execFileAsync('npm', ['--version']);
      npmVersion = npmOut.stdout.trim() || 'unknown';
    } catch { /* ignore */ }
    return { nodeVersion, npmVersion };
  }
}
