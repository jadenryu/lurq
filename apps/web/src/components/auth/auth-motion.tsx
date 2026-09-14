"use client";

import Link from "next/link";
import { useAuth } from "@clerk/nextjs";
import { motion, useReducedMotion } from "framer-motion";
import { useSelectedLayoutSegment } from "next/navigation";
import { EASE, RISE } from "@/components/dashboard/motion";

/**
 * The form column's entrance, on the dashboard's one curve and rise.
 *
 * Keyed on the route segment (sign-in or sign-up), never the full path. Clerk
 * walks its own steps inside one mount, at /sign-up/verify-email-address and the
 * like, and a key change there would remount the component and restart the flow.
 */
export function AuthTransition({ children }: { children: React.ReactNode }) {
  const segment = useSelectedLayoutSegment();
  const reduce = useReducedMotion();

  return (
    <motion.div
      key={segment}
      initial={{ opacity: 0, y: reduce ? 0 : RISE }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: reduce ? 0 : 0.28, ease: EASE }}
    >
      {children}
    </motion.div>
  );
}

/** Where "continue" goes: the visitor's own `redirect_url` when it is on this site, else the dashboard. */
function continueHref(): string {
  const raw = new URLSearchParams(window.location.search).get("redirect_url");
  if (!raw) return "/dashboard";
  try {
    const url = new URL(raw, window.location.origin);
    return url.origin === window.location.origin ? `${url.pathname}${url.search}${url.hash}` : "/dashboard";
  } catch {
    return "/dashboard";
  }
}

/**
 * What the form column shows once a session exists.
 *
 * Clerk finishes a sign-up or sign-in by sending the browser back to /sign-up or
 * /sign-in with the new session, then on to the destination. Its component
 * renders nothing for a signed-in visitor, so for the whole hop, however long the
 * destination took to load, the page was a heading over an empty column. When
 * the hop stalled, a refresh was the only way out. Now it says what is happening,
 * and after a few seconds offers the way through itself.
 */
export function AuthPending({ children }: { children: React.ReactNode }) {
  const { isLoaded, isSignedIn } = useAuth();
  if (!isLoaded || !isSignedIn) return children;

  return (
    <div role="status" aria-live="polite" className="auth-fade flex flex-col items-center gap-4 py-10">
      <span
        aria-hidden
        className="size-5 animate-spin rounded-full border-2 border-muted-foreground/30 border-t-foreground motion-reduce:animate-none"
      />
      <p className="text-sm text-muted-foreground">You&apos;re signed in. Taking you there…</p>
      <Link
        href={continueHref()}
        className="auth-fade-late text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground"
      >
        Continue if nothing happens
      </Link>
    </div>
  );
}
