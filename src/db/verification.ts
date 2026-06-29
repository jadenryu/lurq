/** Read/write helpers for sandbox verification results (`verification_runs`). */
import { and, desc, eq } from 'drizzle-orm';
import type { Database } from './client';
import {
  verificationRuns,
  type NewVerificationRunRow,
  type VerificationRunRow,
} from './schema';

export async function storeVerificationRun(
  db: Database,
  run: NewVerificationRunRow,
): Promise<void> {
  await db.insert(verificationRuns).values(run);
}

/** Most recent run for a package (any version), if any — for the evaluate verdict. */
export async function getLatestVerificationByName(
  db: Database,
  packageName: string,
): Promise<VerificationRunRow | null> {
  const rows = await db
    .select()
    .from(verificationRuns)
    .where(eq(verificationRuns.packageName, packageName))
    .orderBy(desc(verificationRuns.ranAt))
    .limit(1);
  return rows[0] ?? null;
}

/** Most recent run for a package version (any module system), if any. */
export async function getLatestVerification(
  db: Database,
  packageName: string,
  version: string,
): Promise<VerificationRunRow | null> {
  const rows = await db
    .select()
    .from(verificationRuns)
    .where(
      and(eq(verificationRuns.packageName, packageName), eq(verificationRuns.version, version)),
    )
    .orderBy(desc(verificationRuns.ranAt))
    .limit(1);
  return rows[0] ?? null;
}
