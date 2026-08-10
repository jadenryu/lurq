/**
 * The one definition of "this repo's first scan is still in flight".
 *
 * Deliberately in its own module with no `"use client"` and no imports: the
 * repo detail page is a Server Component and the repos table is a Client
 * Component, and both need this rule. Exporting it from scan-progress.tsx
 * (which is `"use client"`) would have compiled fine and then thrown at
 * runtime — Next turns every import a Server Component takes from a client
 * module into a client reference, so calling it on the server fails.
 */

/**
 * `syncInstallation` (the connect callback and the GitHub webhook both use it)
 * starts the scan without awaiting it, so a freshly connected repo has neither a
 * result nor an error for as long as the scan takes. That gap is the pending state.
 *
 * Note the failure mode this cannot see: a scan that dies inside the
 * fire-and-forget `.catch()` writes neither field, so it stays "pending"
 * forever. That is why ScanProgress stops polling on a deadline rather than
 * trusting this to eventually go false.
 */
export function isScanPending(repo: {
  lastScanAt: string | null;
  lastScanError: string | null;
}): boolean {
  return repo.lastScanAt === null && !repo.lastScanError;
}
