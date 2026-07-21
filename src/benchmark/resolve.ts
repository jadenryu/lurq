/**
 * Resolution pipeline — the central module that turns a NormalizedProposal
 * into { packageValidity, compatPrediction, resolution }.
 *
 * Pipeline (from README):
 *   1. Name validation (already done by normalize)
 *   2. Version resolution (npm registry)
 *   3. handleVerify per package → validity
 *   4. handleCompat preflight → compatPrediction
 *   5. E2B co-install (all packages)
 *   6. Smoke-load (runtime only)
 *   7. Failure classification
 */
import type { Database } from '../db/client';
import type { Sandbox, SandboxPackage } from '../sandbox/types';
import { fetchNpmRegistry } from '../ingestion/sources';
import { handleVerify } from '../mcp/handlers';
import { handleCompat } from '../mcp/handlers';
import type {
  FailureClass,
  NormalizedProposal,
  NormalizedSelection,
  PackageValidity,
  ResolvedSelection,
  ResolutionOutcome,
} from './types';

export interface ResolveResult {
  packageValidity: PackageValidity;
  compatPrediction: 'compatible' | 'conflict' | 'unknown';
  resolution: ResolutionOutcome | null;
  resolvedSelections: ResolvedSelection[];
}

export type VersionResolver = (
  packageName: string,
  requestedVersion: string | null,
) => Promise<string | null>;

export interface ResolveOptions {
  dryRun: boolean;
  /** Dependency-injection hooks keep unit tests deterministic and offline. */
  versionResolver?: VersionResolver;
  verifyPackage?: typeof handleVerify;
  compatCheck?: typeof handleCompat;
}

/**
 * Resolve a normalized proposal: validate, version-pin, verify, compat-check,
 * and (unless dry-run) co-install + smoke-load in E2B.
 */
export async function resolveProposal(
  db: Database,
  sandbox: Sandbox | null,
  normalized: NormalizedProposal,
  template: string,
  opts: ResolveOptions,
): Promise<ResolveResult> {
  const allSelections = [...normalized.runtimePackages, ...normalized.developmentPackages];

  // ── Step 2: Version resolution ────────────────────────────────────────────
  // A dry run skips live registry version resolution to stay fast and reproducible.
  let resolvedSelections: ResolvedSelection[];
  let unresolvedVersions: { package: string; requestedVersion: string | null }[] = [];
  
  if (opts.dryRun) {
    resolvedSelections = allSelections.map((selection) => ({ ...selection, resolvedVersion: null }));
  } else {
    resolvedSelections = await resolveVersions(allSelections, opts.versionResolver);
    unresolvedVersions = resolvedSelections
      .filter((selection) => selection.resolvedVersion === null)
      .map((selection) => ({ package: selection.package, requestedVersion: selection.requestedVersion }));
  }

  // ── Step 3: handleVerify per package ──────────────────────────────────────
  const packageValidity = await verifyAll(db, resolvedSelections, opts.verifyPackage ?? handleVerify);
  packageValidity.unresolvedVersions = unresolvedVersions;

  // ── Step 4: handleCompat preflight (name-level evidence preflight) ────────
  let compatPrediction: 'compatible' | 'conflict' | 'unknown' = 'unknown';
  if (allSelections.length >= 2) {
    try {
      // Note: compatPrediction is a name-level evidence preflight, not exact-version
      // compatibility. It is an early signal, not a claimed correctness metric.
      const names = resolvedSelections.map((s) => s.package);
      const compat = await (opts.compatCheck ?? handleCompat)(db, { packages: names });
      compatPrediction = compat.overall;
    } catch {
      compatPrediction = 'unknown';
    }
  }

  // ── Steps 5–7: E2B co-install + smoke-load + classify ────────────────────
  let resolution: ResolutionOutcome | null = null;
  if (!opts.dryRun) {
    if (unresolvedVersions.length > 0) {
      // Never turn an unresolved requested version into npm's moving `latest`.
      // This is a preflight failure, not an E2B resolution attempt.
      resolution = {
        template,
        attempted: false,
        installed: false,
        loaded: [],
        durationMs: 0,
        failureClass: 'version-resolution-failure',
        scriptsFree: true,
      };
    } else {
      if (!sandbox) throw new Error('A live sandbox is required for E2B resolution.');
      resolution = await runE2B(sandbox, resolvedSelections, template);
    }
  }

  return { packageValidity, compatPrediction, resolution, resolvedSelections };
}

// ── Step 2: Version resolution ──────────────────────────────────────────────

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const execFileAsync = promisify(execFile);

/** Get the exact version npm would select for a package constraint. */
export async function fetchExactVersion(
  pkgName: string,
  requestedVersion: string | null,
): Promise<string | null> {
  if (!requestedVersion) {
    const reg = await fetchNpmRegistry(pkgName);
    return reg?.latestVersion ?? null;
  }
  try {
    const { stdout } = await execFileAsync('npm', [
      'view',
      `${pkgName}@${requestedVersion}`,
      'version',
      '--json',
    ]);
    const parsed: unknown = JSON.parse(stdout);
    if (typeof parsed === 'string') return parsed.trim() || null;
    if (Array.isArray(parsed)) {
      const last = parsed.at(-1);
      return typeof last === 'string' && last.trim() ? last.trim() : null;
    }
    return null;
  } catch {
    return null;
  }
}

export async function resolveVersions(
  selections: NormalizedSelection[],
  resolver: VersionResolver = fetchExactVersion,
): Promise<ResolvedSelection[]> {
  // Promise.all retains input order, which keeps benchmark artifacts stable.
  return Promise.all(
    selections.map(async (selection) => {
      const resolvedVersion = await resolver(selection.package, selection.requestedVersion).catch(() => null);
      return { ...selection, resolvedVersion };
    }),
  );
}

// ── Step 3: Verify all ──────────────────────────────────────────────────────

async function verifyAll(
  db: Database,
  selections: ResolvedSelection[],
  verifyPackage: typeof handleVerify,
): Promise<PackageValidity> {
  const nonexistent: string[] = [];
  const deprecated: string[] = [];
  const archived: string[] = [];
  const highRisk: string[] = [];
  let existing = 0;

  // Verify in parallel with a concurrency cap to avoid hammering npm.
  const CONCURRENCY = 5;
  const names = [...new Set(selections.map((s) => s.package))];

  for (let i = 0; i < names.length; i += CONCURRENCY) {
    const batch = names.slice(i, i + CONCURRENCY);
    const results = await Promise.all(
      batch.map(async (name) => {
        try {
          return await verifyPackage(db, { package: name });
        } catch {
          return null;
        }
      }),
    );
    for (let j = 0; j < results.length; j++) {
      const result = results[j];
      const name = batch[j]!;
      if (!result || !result.exists) {
        nonexistent.push(name);
      } else {
        existing++;
        if (result.deprecated) deprecated.push(name);
        if (result.archived) archived.push(name);
        if (result.risk === 'high') highRisk.push(name);
      }
    }
  }

  return { existing, nonexistent, deprecated, archived, highRisk, unresolvedVersions: [] };
}

// ── Steps 5–7: E2B resolution ───────────────────────────────────────────────

async function runE2B(
  sandbox: Sandbox,
  allSelections: ResolvedSelection[],
  template: string,
): Promise<ResolutionOutcome> {
  const installPackages: SandboxPackage[] = allSelections.map((s) => ({
    name: s.package,
    version: s.resolvedVersion,
  }));
  const smokePackages: SandboxPackage[] = allSelections
    .filter((s) => s.isRuntime)
    .map((s) => ({
      name: s.package,
      version: s.resolvedVersion,
    }));

  const started = Date.now();
  try {
    const result = await sandbox.verifySet(installPackages, {
      smokePackages,
      allowScripts: false,
      target: { node: '20', moduleSystem: 'esm' },
    });

    let failureClass: FailureClass | null = null;
    if (!result.installed) {
      failureClass = classifyFailure(result.error);
    } else {
      // Check if any runtime package failed to load.
      const loadFailed = result.loaded.some((l) => l.loaded === false);
      if (loadFailed) {
        failureClass = 'runtime-load-failure';
      }
    }

    return {
      template,
      attempted: true,
      installed: result.installed,
      loaded: result.loaded,
      durationMs: result.durationMs,
      failureClass,
      scriptsFree: true,
    };
  } catch (err) {
    return {
      template,
      attempted: true,
      installed: false,
      loaded: [],
      durationMs: Date.now() - started,
      failureClass: classifyFailure(String(err)),
      scriptsFree: true,
    };
  }
}

// ── Failure classification ──────────────────────────────────────────────────

/**
 * Classify an npm install error into a FailureClass.
 * `install-script-failure` is never assigned in v1 (scripts off).
 */
function classifyFailure(error: string | null): FailureClass {
  if (!error) return 'unknown-resolution-failure';
  const lower = error.toLowerCase();

  if (lower.includes('eresolve') || lower.includes('peer dep') || lower.includes('could not resolve')) {
    return 'peer-dependency-conflict';
  }
  if (lower.includes('engine') && (lower.includes('not compatible') || lower.includes('unsupported'))) {
    return 'engine-conflict';
  }
  if (lower.includes('e404') || lower.includes('404 not found') || lower.includes('not found in the npm registry')) {
    return 'nonexistent-package';
  }
  if (lower.includes('node-gyp') || lower.includes('node-pre-gyp') || lower.includes('prebuild-install')) {
    return 'native-build-failure';
  }
  if (lower.includes('timeout') || lower.includes('timed out')) {
    return 'timeout';
  }
  return 'unknown-resolution-failure';
}
