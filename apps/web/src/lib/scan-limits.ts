/**
 * How many dependency rows a signed-out visitor reads in full.
 *
 * ONE CONSTANT, TWO SURFACES, AND THE RELATION BETWEEN THEM IS THE POINT. The
 * hero box (components/site/repo-scan.tsx) shows this many to anyone, and the
 * report page (components/site/scan-report.tsx) shows the same many before the
 * blur starts. Somebody who scanned from the landing page and followed the link
 * must never arrive at LESS than they were already given — that reads as a
 * bait-and-switch and costs the sign-up it was meant to earn. Two constants
 * kept equal by a comment is a rule that survives until the first person edits
 * one of them, so there is only one.
 *
 * Its own module, and a plain one: lib/public-scan.ts is `server-only` and the
 * hero is a client component, so they cannot share a file.
 */
export const FREE_DEPS = 8;
