"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Dialog } from "@base-ui/react/dialog";
import { useAuth } from "@clerk/nextjs";
import { Wordmark } from "@/components/site/wordmark";
import { NAV_CTA, NAV_DASHBOARD, NAV_DOCS, NAV_SIGN_IN } from "@/content/copy";
import { DOCS_URL } from "@/lib/site-links";

/**
 * Two states: a 1180px transparent bar at rest, an 860px pill past 80px.
 *
 * The contraction is the point. A bar that only loses height reads as a glitch;
 * a bar that pulls its ends toward the centre reads as condensing. Sign in goes
 * with it: someone this far down the page is closer to installing than to
 * signing in, and dropping the secondary action is what gets the pill narrow
 * enough to look deliberate.
 *
 * THE MEGA MENU IS GONE, AND IT IS NOT COMING BACK WITHOUT A REASON.
 *
 * A previous pass put three hover panels here on @base-ui/react's
 * navigation-menu. They never rendered. The triggers were visible and were
 * receiving pointer events (the click showed up in the browser's own INP
 * attribution), but the panel itself was an invisible box, and the cause was the
 * arrangement rather than a bug in the library: the popup was sized from
 * `--popup-width` / `--popup-height` while the content inside it was
 * `position: absolute`, so nothing contributed height, the popup collapsed, and
 * `overflow: hidden` clipped what was left. That is a real trap, and it is worth
 * writing down because the fix is not obvious and the failure is silent.
 *
 * It was ALSO the wrong component for this site. A mega menu is what you build
 * when the nav cannot fit the destinations, and this nav has four. The panels
 * bought a hover interaction that does not exist on a phone and a class of bug
 * that does. Four links cannot break.
 *
 * The destinations have since shrunk further: /product, /solutions, /proof and
 * /changelog were removed, so every link up here is a section of this page or
 * the docs. If the product ever has enough surface that four links stop covering
 * it, the thing to reach for is Base UI's navigation-menu again, with the
 * content laid out in normal flow and the popup sized by it.
 *
 * Geometry and colour live in tokens.css (.room-nav-*, .room-sheet-*). This file
 * owns which of the two bar states is current.
 *
 * The install command is not up here. It appears once on this page, in the hero.
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

/**
 * The bar's own links. Four, and the order is the order a reader needs them:
 * what it is, how to get it, how to call it, what it costs.
 *
 * All four now point at sections of this page or at the docs, because the pages
 * the first two used to open no longer exist. That is a smaller nav rather than
 * a worse one: every destination is one scroll or one hop, and nothing up here
 * can rot into a 404.
 */
const LINKS: { label: string; href: string; external?: boolean }[] = [
  { label: "What it does", href: "/#tools" },
  { label: "Ways in", href: "/#use" },
  { label: NAV_DOCS, href: DOCS_URL, external: true },
  { label: "Pricing", href: "/#pricing" },
];

const linkClass =
  "text-[14px] text-ink-2 transition-[color] hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-mark";

/**
 * The sheet, for everything under 900px.
 *
 * The same four links the bar carries, not a separate list. It used to render
 * the twenty destinations from content/nav.ts on the argument that a phone has
 * room to scroll; that file is gone with the pages it addressed, and four links
 * do not need a second source of truth. Flat, not an accordion, so nothing needs
 * tapping before a link is visible.
 *
 * Dialog rather than a hand-rolled overlay: focus trap, scroll lock, escape and
 * inert background are four things worth not writing twice. Unlike the panels
 * this replaced, a Dialog has no positioner and nothing to collapse.
 */
function Sheet({ signedIn }: { signedIn: boolean | undefined }) {
  const [open, setOpen] = useState(false);
  const close = () => setOpen(false);

  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Trigger
        className="-mr-2 inline-flex h-9 w-9 items-center justify-center rounded-md text-ink-2 transition-[color] hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-mark min-[900px]:hidden"
        aria-label="Open menu"
      >
        <svg aria-hidden viewBox="0 0 20 20" width="18" height="18" fill="none">
          <path d="M3 6h14M3 10h14M3 14h14" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
      </Dialog.Trigger>

      <Dialog.Portal>
        <Dialog.Backdrop className="room-sheet-backdrop" />
        <Dialog.Popup className="room-sheet">
          <div className="flex items-center justify-between">
            <Wordmark href="/" size={17} />
            <Dialog.Close
              aria-label="Close menu"
              className="-mr-2 inline-flex h-9 w-9 items-center justify-center rounded-md text-ink-2 hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-mark"
            >
              <svg aria-hidden viewBox="0 0 20 20" width="18" height="18" fill="none">
                <path d="M5 5l10 10M15 5L5 15" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
              </svg>
            </Dialog.Close>
          </div>

          <div className="mt-6">
            {LINKS.map((link) =>
              link.external ? (
                <a
                  key={link.href}
                  href={link.href}
                  target="_blank"
                  rel="noopener"
                  className="room-sheet-row"
                  onClick={close}
                >
                  {link.label}
                  <span aria-hidden className="text-[11px] text-ink-3">
                    ↗
                  </span>
                </a>
              ) : (
                <Link key={link.href} href={link.href} className="room-sheet-row" onClick={close}>
                  {link.label}
                  <span aria-hidden className="text-[11px] text-ink-3">
                    →
                  </span>
                </Link>
              ),
            )}
          </div>

          <div className="mt-8 flex flex-col gap-3">
            <Link
              href={signedIn ? "/dashboard" : "/sign-up"}
              onClick={close}
              className="inline-flex h-11 items-center justify-center rounded-full bg-ink text-[14px] font-medium text-ground"
            >
              {signedIn ? NAV_DASHBOARD : NAV_CTA}
            </Link>
            {!signedIn && (
              <Link
                href="/sign-in"
                onClick={close}
                className="inline-flex h-11 items-center justify-center rounded-full border border-edge text-[14px] text-ink-2"
              >
                {NAV_SIGN_IN}
              </Link>
            )}
          </div>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

export function SiteNav() {
  const [condensed, setCondensed] = useState(false);
  const [transitioning, setTransitioning] = useState(false);
  const { isSignedIn } = useAuth();

  useEffect(() => {
    // The live state is mirrored here so the handler can compare against it and
    // return without a render on the overwhelming majority of scroll events:
    // the ones that don't cross a threshold.
    let current = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const onScroll = () => {
      const y = window.scrollY;
      const next = current ? y >= EXPAND_AT : y >= CONDENSE_AT;
      if (next === current) return;
      current = next;

      // Both in the one handler, so React batches them into a single render.
      // will-change is carried for the length of the transition and then
      // dropped; left on, it pins a compositor layer for a bar that moves twice
      // in a session.
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

        {/* Centre group, hidden under 900px where the sheet carries all of it.
            Its own <nav> rather than a second list inside the right-hand one, so
            the section links and the account actions are two landmarks a screen
            reader can tell apart. */}
        <nav aria-label="Sections" className="room-nav-center hidden min-[900px]:flex">
          {LINKS.map((link) =>
            link.external ? (
              <a
                key={link.href}
                href={link.href}
                target="_blank"
                rel="noopener"
                className={linkClass}
                style={hover}
              >
                {link.label}
                <span aria-hidden className="pl-1 text-[10px] opacity-60">
                  ↗
                </span>
              </a>
            ) : (
              <Link key={link.href} href={link.href} className={linkClass} style={hover}>
                {link.label}
              </Link>
            ),
          )}
        </nav>

        <nav aria-label="Account" className="room-nav-links">
          {/* Signed OUT this is "Sign in", the quiet counterpart to the CTA's
              "Get started". Signed IN it renders nothing: the CTA beside it has
              become "Dashboard", and two adjacent links to the same page is the
              kind of thing that reads as a bug even when it works. */}
          {!isSignedIn && (
            <span className="room-nav-signin hidden min-[900px]:inline-flex">
              <Link href="/sign-in" className={linkClass} style={hover}>
                {NAV_SIGN_IN}
              </Link>
            </span>
          )}
          {/* The primary action is an ACCOUNT, not a page to read. A signed-in
              visitor gets the dashboard instead: offering "Get started" to
              someone who already started is a dead end. */}
          <Link
            href={isSignedIn ? "/dashboard" : "/sign-up"}
            className="inline-flex h-9 shrink-0 items-center rounded-full bg-ink px-4.5 text-[14px] font-medium text-ground transition-[background-color] hover:bg-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-mark"
            style={hover}
          >
            {isSignedIn ? NAV_DASHBOARD : NAV_CTA}
          </Link>
          <Sheet signedIn={isSignedIn} />
        </nav>
      </div>
    </header>
  );
}
