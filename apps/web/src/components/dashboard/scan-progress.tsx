"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

/**
 * Keeps a repo page honest while a first scan is still running.
 *
 * `/repos/connect` registers the repositories and then kicks the scan off
 * without awaiting it — deliberately, because a first scan of a large account is
 * minutes of GitHub calls and holding the request open would time out at the
 * edge and look like a failed install. The cost is that the user lands on
 * /dashboard/repos while the scan is still going.
 *
 * Both repo pages are server components, so they render once and never look
 * again. The only thing in the whole flow that re-read the data was
 * `router.refresh()` inside the rescan button, which is why drift appeared to
 * exist only after someone pressed rescan: the first scan was landing into a
 * page nobody refreshed. The page even promised "drift appears as it finishes",
 * which nothing was making true.
 *
 * So: poll while anything is unscanned, and say so on screen meanwhile.
 */

/** Slow enough not to hammer the issuer, quick enough to feel live. */
const POLL_MS = 4_000;

/**
 * Stop after this long without the pending count changing. A repo whose scan
 * died inside the fire-and-forget `.catch()` never gets a `lastScanAt` *or* a
 * `lastScanError`, so "pending" is a state it can sit in forever — and an
 * un-capped poll would refresh the route every 4s for as long as the tab is
 * open. The deadline resets whenever the count moves, so real progress keeps it
 * alive and only a genuinely stuck scan trips it.
 */
const GIVE_UP_MS = 4 * 60 * 1_000;

export function ScanProgress({
  pending,
  total,
}: {
  /** Repositories that have never been scanned and have not errored. */
  pending: number;
  /** Total connected repositories, so the notice can report a fraction. */
  total?: number;
}) {
  const router = useRouter();
  const [gaveUp, setGaveUp] = useState(false);

  // Clear the deadline whenever the count moves, adjusted during render rather
  // than from an effect body: resetting state in an effect triggers a cascading
  // render, and this is React's documented way to react to a changed prop.
  // Inside the interval below, setGaveUp runs from a callback, which is fine.
  const [countWhenArmed, setCountWhenArmed] = useState(pending);
  if (countWhenArmed !== pending) {
    setCountWhenArmed(pending);
    if (gaveUp) setGaveUp(false);
  }

  useEffect(() => {
    if (pending === 0) return;
    // Re-armed on every change to `pending`, which is what makes the deadline
    // measure "time since the last repo finished" rather than time since mount.
    const startedAt = Date.now();
    const id = setInterval(() => {
      if (Date.now() - startedAt > GIVE_UP_MS) {
        setGaveUp(true);
        clearInterval(id);
        return;
      }
      router.refresh();
    }, POLL_MS);
    return () => clearInterval(id);
  }, [pending, router]);

  if (pending === 0) return null;

  const done = total ? total - pending : 0;
  // The fraction is the only real progress available: the scan reports nothing
  // until a repo is finished, so a percentage bar here would be invented.
  const fraction = total && total > 1 ? `${done} of ${total} read · ` : "";

  return (
    <div className="relative overflow-hidden rounded-[var(--radius-control)] border border-edge bg-surface-2 px-4 py-3">
      <span aria-hidden className="absolute inset-y-0 left-0 w-[2px] bg-signal" />
      <p className="flex items-center gap-2.5 text-sm text-ink-2" role="status" aria-live="polite">
        {/* --signal (interaction), not a verdict colour: a scan in flight is not
            a finding about the code. */}
        <span
          aria-hidden
          className="inline-block size-1.5 shrink-0 animate-pulse rounded-full bg-signal motion-reduce:animate-none"
        />
        {gaveUp ? (
          <span>
            {fraction}
            {pending} still unread after four minutes. The scan may have failed quietly —
            press rescan on the row, or reload.
          </span>
        ) : (
          <span>
            {fraction}reading {pending === 1 ? "manifests" : `manifests for ${pending} repositories`}{" "}
            from GitHub. This updates on its own.
          </span>
        )}
      </p>
    </div>
  );
}
