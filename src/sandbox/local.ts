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
  type ExecOptions,
  type ExecResult,
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
const EXEC_MAX_BUFFER = 8 * 1024 * 1024;

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

/**
 * Load the package the way that works for both module systems.
 *
 * This used to branch on the target's `moduleSystem`, which nothing ever
 * derived from the package — DEFAULT_TARGET hardcodes 'cjs', so every smoke
 * load was a `require()`. An ESM-only package therefore came back
 * ERR_REQUIRE_ESM and was recorded as failing to load. Measured: nanoid@6.0.1,
 * a package that works perfectly, reported `installed: yes, loaded: no`.
 *
 * That verdict is not cosmetic — it feeds `verify` and the recommendation path,
 * so lurq was calling a large and growing share of the modern registry broken.
 * chalk, node-fetch, execa, got, ora and nanoid have all gone ESM-only.
 *
 * `import()` handles both: Node wraps a CJS module and hands back its exports
 * as `default`. So there is nothing to detect and no branch to get wrong, and
 * "does `import` work" is the right definition of loading in 2026 anyway.
 */
export function smokeScript(pkg: string): string[] {
  return ['--input-type=module', '-e', `await import(${JSON.stringify(pkg)})`];
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
          await execFileAsync('node', smokeScript(smokeTargets[i]!.name), {
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

  async exec(command: string, opts: ExecOptions = {}): Promise<ExecResult> {
    const dir = await mkdtemp(join(tmpdir(), 'lurq-exec-'));
    try {
      await writeFile(
        join(dir, 'package.json'),
        JSON.stringify({ name: 'lurq-sandbox', version: '0.0.0', private: true }),
      );
      if (opts.install?.length) {
        await execFileAsync(
          'npm',
          npmInstallArgs(opts.install.map(toSpec), { allowScripts: opts.allowScripts ?? false }),
          { cwd: dir, timeout: opts.timeoutMs ?? INSTALL_TIMEOUT_MS, signal: opts.signal },
        );
      }
      const { stdout, stderr } = await execFileAsync('sh', ['-c', command], {
        cwd: dir,
        timeout: opts.timeoutMs ?? SMOKE_TIMEOUT_MS,
        signal: opts.signal,
        maxBuffer: EXEC_MAX_BUFFER,
      });
      return { exitCode: 0, stdout, stderr };
    } catch (err) {
      // A non-zero exit is a result the oracle interprets, not a thrown error.
      const e = err as { code?: unknown; stdout?: unknown; stderr?: unknown };
      if (typeof e?.code === 'number') {
        return {
          exitCode: e.code,
          stdout: typeof e.stdout === 'string' ? e.stdout : '',
          stderr: typeof e.stderr === 'string' ? e.stderr : stderrOf(err),
        };
      }
      throw err; // timeout / spawn failure — infrastructure, not the subject
    } finally {
      await rm(dir, { recursive: true, force: true }).catch(() => {});
    }
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
