"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useAuth } from "@clerk/nextjs";
import { Wordmark } from "@/components/site/wordmark";
import {
  NAV_CTA,
  NAV_DASHBOARD,
  NAV_DOCS,
  NAV_GITHUB,
  NAV_SIGN_IN,
} from "@/content/copy";
import { REPO_URL } from "@/lib/marketing-copy";
import { DOCS_URL } from "@/lib/site-links";
import { cn } from "@/lib/utils";

/**
 * Two states: a 1180px transparent bar at rest, an 860px pill past 80px.
 *
 * The contraction is the whole point. A bar that only loses height reads as a
 * glitch; a bar that pulls its ends toward the centre reads as condensing. Sign
 * in goes with it: someone this far down the page is closer to installing than
 * to signing in, and dropping the secondary action is what gets the pill narrow
 * enough to look deliberate.
 *
 * Geometry, colour and the collapse all live in tokens.css (.room-nav-*). This
 * file owns one thing: which of the two states is current.
 *
 * No blur behind it. The install command is not here either: it appears once on
 * this page, in the hero.
 */

/**
 * Two thresholds, not one. On a single threshold a scroll parked at exactly 80px
 * strobes between the states on every sub-pixel wheel event, which looks broken
 * without ever looking like a bug you could name.
 */
const CONDENSE_AT = 80;
const EXPAND_AT = 60;

/** Matches the transition duration in tokens.css. */
const TRANSITION_MS = 280;

export function SiteNav() {
  const [condensed, setCondensed] = useState(false);
  const [transitioning, setTransitioning] = useState(false);
  const { isSignedIn } = useAuth();

  useEffect(() => {
    // The live state is mirrored here so the handler can compare against it and
    // return without a render on the overwhelming majority of scroll events: // the ones that don't cross a threshold.
    let current = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const onScroll = () => {
      const y = window.scrollY;
      const next = current ? y >= EXPAND_AT : y >= CONDENSE_AT;
      if (next === current) return;
      current = next;

      // Both in the one event handler, so React batches them into a single
      // render. will-change is carried for the length of the transition and
      // then dropped; left on, it pins a compositor layer for a bar that moves
      // twice in a session.
      setCondensed(next);
      setTransitioning(true);
      clearTimeout(timer);
      timer = setTimeout(() => setTransitioning(false), TRANSITION_MS);
    };

    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      window.removeEventListener("scroll", onScroll);
      clearTimeout(timer);
    };
  }, []);

  const link =
    "text-[14px] text-ink-2 transition-[color] hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-mark";
  const hover = { transitionDuration: "var(--dur-hover)" };

  return (
    // The header is a spacer: it holds 68px of flow while the bar itself is
    // fixed, so nothing below shifts when the bar leaves the top edge.
    <header className="room-nav">
      <div
        data-reveal
        data-condensed={condensed}
        data-transitioning={transitioning || undefined}
        className="room-nav-bar"
        style={{ ["--reveal-at" as string]: "0ms" }}
      >
        <Wordmark href="/" size={17} />

        <nav className="room-nav-links">
          <a href={DOCS_URL} className={cn(link, "hidden sm:inline")} style={hover}>
            {NAV_DOCS}
          </a>
          <a
            href={REPO_URL}
            target="_blank"
            rel="noopener"
            className={cn(link, "hidden sm:inline")}
            style={hover}
          >
            {NAV_GITHUB}
            <span aria-hidden className="pl-1 text-[10px] opacity-60">
              ↗
            </span>
          </a>
          {/* The wrapper owns the collapse, the link owns its hover. Keeping the
              two transitions on separate elements means neither has to know the
              other's property list.

              Same tab stop either way; the label follows the session so a
              signed-in visitor isn't invited to sign in again. */}
          <span className="room-nav-signin">
            <Link
              href={isSignedIn ? "/dashboard" : "/sign-in"}
              className={link}
              style={hover}
            >
              {isSignedIn ? NAV_DASHBOARD : NAV_SIGN_IN}
            </Link>
          </span>
          {/* Condensed, this sends you back to the top rather than to the docs.
              The install command is already on this page: someone who scrolled
              past it and then reached for "Get started" is asking for the thing
              they scrolled past, not for a different page. At rest the command
              is right there, so the link behaves normally.

              Still an <a href> either way: a keyboard or middle-click user, and
              anyone whose JS hasn't run, gets a real destination. */}
          <Link
            href="/docs/quickstart"
            onClick={(e) => {
              if (!condensed) return;
              e.preventDefault();
              window.scrollTo({
                top: 0,
                behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches
                  ? "auto"
                  : "smooth",
              });
            }}
            className="inline-flex h-9 shrink-0 items-center rounded-md bg-ink px-4 text-[14px] font-medium text-ground transition-[background-color] hover:bg-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-mark"
            style={hover}
          >
            {NAV_CTA}
          </Link>
        </nav>
      </div>
    </header>
  );
}
