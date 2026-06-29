/**
 * Run a package version through the sandbox and persist the result. Decoupled
 * from the query path: an operator/cron drives this in the background and the
 * stored verdict is read instantly at recommend/verify time.
 */
import type { Database } from '../db/client';
import { storeVerificationRun } from '../db/verification';
import { getSandbox } from '../sandbox';
import type { SandboxResult, SandboxVerifyOptions } from '../sandbox/types';

export async function verifyPackageInSandbox(
  db: Database,
  pkg: string,
  version: string | null,
  opts: SandboxVerifyOptions = {},
): Promise<SandboxResult> {
  const result = await getSandbox().verify(pkg, version, opts);
  // Persist for the query path. Non-fatal: never fail the run on a write error.
  await storeVerificationRun(db, {
    packageName: pkg,
    version: version ?? 'latest',
    driver: result.driver,
    moduleSystem: result.moduleSystem,
    installed: result.installed,
    imported: result.imported,
    ranScripts: result.ranScripts,
    durationMs: result.durationMs,
    error: result.error,
    ranAt: new Date(),
  }).catch(() => {});
  return result;
}
