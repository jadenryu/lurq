"use client";

/**
 * The dashboard's error boundary.
 *
 * There was none — anywhere in the app — so any throw on the way to rendering a
 * dashboard page fell through to Next's default error screen. That is the
 * "clicked Dashboard and got an error" report: the nav is right that you are
 * signed in, and the page behind it dies on a transient the loaders were never
 * given a chance to swallow.
 *
 * `dashboard-data.ts` already degrades a failed READ to the new-user state, so
 * anything reaching here is the narrower case: the session lookup itself, a
 * render-time throw, or a bug. All three are recoverable by trying again, which
 * is why `reset()` is the primary action rather than a link home.
 *
 * Deliberately does not print `error.message`. A server-side message on this
 * boundary can carry an upstream URL or a config hint, and the digest is what
 * actually correlates to the server log.
 */

import { useEffect } from "react";
import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";

export default function DashboardError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[lurq] dashboard render failed:", error);
  }, [error]);

  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center gap-5 px-4 text-center">
      <div className="flex flex-col gap-2">
        <h1 className="font-heading text-xl font-semibold text-foreground">
          This page didn&apos;t load.
        </h1>
        <p className="max-w-sm text-sm text-muted-foreground">
          Your account is fine and your keys are untouched. This is usually a
          brief hiccup reaching the index service.
        </p>
      </div>

      <div className="flex flex-wrap items-center justify-center gap-2">
        <button type="button" onClick={reset} className={buttonVariants()}>
          Try again
        </button>
        <Link href="/dashboard/keys" className={buttonVariants({ variant: "outline" })}>
          Go to keys
        </Link>
      </div>

      {error.digest ? (
        <p className="font-mono text-[11px] text-muted-foreground/70">
          Reference {error.digest}
        </p>
      ) : null}
    </div>
  );
}
