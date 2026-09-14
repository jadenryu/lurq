/**
 * The public set: the packages lurq answers for without a key.
 *
 * Only packages inside the top PUBLIC_TOP_LIMIT by weekly downloads, so the
 * public surface is the set people actually search for rather than every row
 * waiting to be enumerated. The package summaries and the upgrade pages share
 * this one gate, so a package is either public on both or on neither.
 */
import { and, desc, isNotNull } from 'drizzle-orm';
import type { Database } from '../db/client';
import { getPackageByName } from '../db/packages';
import { packages } from '../db/schema';

export const PUBLIC_TOP_LIMIT = 5_000;

/** npm's own name rules, loosely: optional scope, url-safe, 214 chars max. */
const NPM_NAME = /^(?:@[a-z0-9-~][a-z0-9-._~]*\/)?[a-z0-9-~][a-z0-9-._~]*$/i;

export function validPackageName(name: string): boolean {
  return name.length > 0 && name.length <= 214 && NPM_NAME.test(name);
}

/**
 * The weekly-download count of the PUBLIC_TOP_LIMIT-th package, refreshed
 * hourly, so "is this inside the public set" is one comparison per request
 * instead of a rank query.
 *
 * ponytail: per-process cache; share it if the API ever runs more than a couple
 * of replicas.
 */
let floor: { at: number; value: number } | null = null;

export async function publicDownloadFloor(db: Database): Promise<number> {
  if (floor && Date.now() - floor.at < 3_600_000) return floor.value;
  const rows = await db
    .select({ downloads: packages.weeklyDownloads })
    .from(packages)
    .where(and(isNotNull(packages.weeklyDownloads), isNotNull(packages.healthScore)))
    .orderBy(desc(packages.weeklyDownloads))
    .offset(PUBLIC_TOP_LIMIT - 1)
    .limit(1);
  floor = { at: Date.now(), value: Number(rows[0]?.downloads ?? 0) };
  return floor.value;
}

type PackageRow = NonNullable<Awaited<ReturnType<typeof getPackageByName>>>;

/** The row when `name` is scored and inside the public set; null otherwise. */
export async function publicPackageRow(db: Database, name: string): Promise<PackageRow | null> {
  const [row, min] = await Promise.all([getPackageByName(db, name), publicDownloadFloor(db)]);
  if (!row || row.healthScore === null || (row.weeklyDownloads ?? 0) < min) return null;
  return row;
}
