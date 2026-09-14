"use client";

/**
 * The error boundary for everything the dashboard's own does not cover: the
 * marketing pages, /sign-in and /sign-up.
 *
 * There was none, so a throw on those routes fell through to Next's bare
 * "Application error" screen, whose only way out was the browser's refresh
 * button. `retry()` fetches the segment again, which is what the refresh did.
 */

import { useEffect } from "react";
import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";

export default function AppError({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  useEffect(() => {
    console.error("[lurq] render failed:", error);
  }, [error]);

  return (
    <div className="auth-fade flex min-h-[60vh] flex-1 flex-col items-center justify-center gap-5 px-4 text-center">
      <div className="flex flex-col gap-2">
        <h1 className="font-heading text-xl font-semibold text-foreground">This page didn&apos;t load.</h1>
        <p className="max-w-sm text-sm text-muted-foreground">
          Usually a brief hiccup. Trying again picks up where you were.
        </p>
      </div>
      <div className="flex flex-wrap items-center justify-center gap-2">
        <button type="button" onClick={retry} className={buttonVariants()}>
          Try again
        </button>
        <Link href="/" className={buttonVariants({ variant: "outline" })}>
          Go home
        </Link>
      </div>
      {error.digest ? (
        <p className="font-mono text-[11px] text-muted-foreground/70">Reference {error.digest}</p>
      ) : null}
    </div>
  );
}
