"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { NavigationMenu } from "@base-ui/react/navigation-menu";
import { Dialog } from "@base-ui/react/dialog";
import { useAuth } from "@clerk/nextjs";
import { Wordmark } from "@/components/site/wordmark";
import {
  NAV_CTA,
  NAV_DASHBOARD,
  NAV_SIGN_IN,
} from "@/content/copy";
import { FLAT_LINKS, MENUS, type NavLink, type NavMenu } from "@/content/nav";
import { cn } from "@/lib/utils";

/**
 * Two states: a 1180px transparent bar at rest, an 860px pill past 80px. Under
 * it, three mega panels.
 *
 * The contraction is unchanged and is still the point. A bar that only loses
 * height reads as a glitch; a bar that pulls its ends toward the centre reads as
 * condensing. Sign in goes with it: someone this far down the page is closer to
 * installing than to signing in, and dropping the secondary action is what gets
 * the pill narrow enough to look deliberate.
 *
 * WHAT IS NEW. The bar used to carry two links. It now carries the whole site,
 * which needed panels, which needed a component: focus order, escape, the
 * pointer-safe path from a trigger down into the panel under it, and the rule
 * that hovering a second trigger swaps the panel instead of opening a second
 * one. @base-ui/react was already installed and already ships navigation-menu,
 * so none of that is written here. Geometry and colour live in tokens.css
 * (.room-menu-*, .room-sheet-*) with the rest of the room; this file owns which
 * of the two bar states is current, and nothing else.
 *
 * WHY THE TRIGGERS ARE NOT LINKS. Product and Solutions both have index pages
 * and it is tempting to make the trigger navigate to them. It cannot: a control
 * that opens a panel on hover and navigates on click is two controls sharing a
 * hit area, and on a trackpad the click lands while the panel is opening. The
 * index page is the first row inside each panel instead, where it is a
 * destination like any other.
 *
 * The install command is not up here. It appears once on the page, in the hero.
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
 * 900px is where the panels stop and the sheet takes over, and it is written out
 * at every use rather than composed from a constant.
 *
 * `${SHEET_BELOW}hidden` was the first version and it compiled to nothing.
 * Tailwind scans source text for whole class strings; a variant assembled at
 * runtime is not in the file, so `min-[900px]:hidden` was never generated and
 * the burger sat next to the full menu at every width. The literal is the API.
 */

const linkClass =
  "text-[14px] text-ink-2 transition-[color] hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-mark";

/** The 9px caret. Drawn rather than imported: one path is cheaper than an icon. */
function Caret() {
  return (
    <svg aria-hidden viewBox="0 0 10 6" width="9" height="6" fill="none">
      <path d="M1 1.5 5 4.5 9 1.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  );
}

/**
 * One destination inside a panel.
 *
 * NavigationMenu.Link rather than a bare anchor: it is what closes the panel on
 * activation and keeps the trigger's aria state honest. `render` is how Base UI
 * takes next/link, which is the documented composition and the reason an
 * internal row still gets a client-side navigation.
 */
function Row({ link }: { link: NavLink }) {
  const body = (
    <>
      <span className="flex items-baseline gap-1.5">
        <span className="text-[14px] font-medium text-ink">{link.label}</span>
        {link.fresh && (
          <span className="rounded-full bg-surface-2 px-1.5 py-px font-mono text-[10px] text-ink-3">
            new
          </span>
        )}
        {link.external ? (
          <span aria-hidden className="text-[10px] text-ink-3 opacity-70">
            ↗
          </span>
        ) : (
          <span aria-hidden className="room-menu-row-arrow text-[11px] text-ink-3">
            →
          </span>
        )}
      </span>
      {link.blurb && (
        <span className="mt-0.5 block max-w-[30ch] text-[12.5px] leading-[1.5] text-ink-3">
          {link.blurb}
        </span>
      )}
    </>
  );

  return (
    <NavigationMenu.Link
      className="room-menu-row"
      render={
        link.external ? (
          <a href={link.href} target="_blank" rel="noopener" />
        ) : (
          <Link href={link.href} />
        )
      }
    >
      {body}
    </NavigationMenu.Link>
  );
}

function Panel({ menu }: { menu: NavMenu }) {
  return (
    <div
      className={cn(
        "flex gap-6",
        // The rail is a column of the same grid rather than a sibling flex item,
        // so a panel without one closes up instead of leaving a gap where it
        // would have been.
        menu.feature ? "w-[760px]" : "w-[600px]",
      )}
    >
      <div className={cn("grid flex-1 gap-x-4", menu.columns.length === 3 ? "grid-cols-3" : "grid-cols-2")}>
        {menu.columns.map((col) => (
          <div key={col.heading}>
            <p className="px-[10px] pb-1.5 font-mono text-[10.5px] uppercase tracking-[0.07em] text-ink-3">
              {col.heading}
            </p>
            <div className="flex flex-col">
              {col.links.map((link) => (
                <Row key={link.label + link.href} link={link} />
              ))}
            </div>
          </div>
        ))}
      </div>

      {menu.feature && (
        <NavigationMenu.Link
          className="room-menu-feature w-[228px] shrink-0"
          render={<Link href={menu.feature.href} />}
        >
          <span className="font-mono text-[10.5px] uppercase tracking-[0.07em] text-ink-3">
            {menu.feature.eyebrow}
          </span>
          <span className="mt-2 block text-[14px] font-medium leading-snug text-ink">
            {menu.feature.title}
          </span>
          <span className="mt-2 block flex-1 text-[12.5px] leading-[1.55] text-ink-2">
            {menu.feature.body}
          </span>
          <span className="mt-4 block text-[12.5px] text-mark">
            {menu.feature.cta}
            <span aria-hidden className="pl-1">
              →
            </span>
          </span>
        </NavigationMenu.Link>
      )}
    </div>
  );
}

/**
 * The sheet, for everything under 900px.
 *
 * Flat, not an accordion. Three collapsed sections on a phone is three taps
 * before anyone sees a destination, and the whole IA is twenty rows: it fits in
 * a scroll. `Dialog` rather than a hand-rolled overlay for the same reason the
 * panels are Base UI's: focus trap, scroll lock, escape, and inert content
 * behind it are four things worth not writing twice.
 */
function Sheet({ signedIn }: { signedIn: boolean | undefined }) {
  const [open, setOpen] = useState(false);

  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Trigger
        className={cn(
          "-mr-2 inline-flex h-9 w-9 items-center justify-center rounded-md text-ink-2 transition-[color] hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-mark",
          "min-[900px]:hidden",
        )}
        aria-label="Open menu"
      >
        <svg aria-hidden viewBox="0 0 20 20" width="18" height="18" fill="none">
          <path
            d="M3 6h14M3 10h14M3 14h14"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
          />
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
                <path
                  d="M5 5l10 10M15 5L5 15"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                />
              </svg>
            </Dialog.Close>
          </div>

          {/* The same MENUS the panels render. A destination added to the IA
              file appears here without anyone remembering to add it twice, which
              is the failure this whole arrangement is guarding against. */}
          {MENUS.flatMap((menu) =>
            menu.columns.map((col) => (
              <div key={`${menu.label}-${col.heading}`}>
                <p className="room-sheet-heading">
                  {menu.label} · {col.heading}
                </p>
                {col.links.map((link) =>
                  link.external ? (
                    <a
                      key={link.href}
                      href={link.href}
                      target="_blank"
                      rel="noopener"
                      className="room-sheet-row"
                      onClick={() => setOpen(false)}
                    >
                      {link.label}
                      <span aria-hidden className="text-[11px] text-ink-3">
                        ↗
                      </span>
                    </a>
                  ) : (
                    <Link
                      key={link.href}
                      href={link.href}
                      className="room-sheet-row"
                      onClick={() => setOpen(false)}
                    >
                      {link.label}
                      <span aria-hidden className="text-[11px] text-ink-3">
                        →
                      </span>
                    </Link>
                  ),
                )}
              </div>
            )),
          )}

          <div className="mt-8 flex flex-col gap-3">
            <Link
              href={signedIn ? "/dashboard" : "/sign-up"}
              onClick={() => setOpen(false)}
              className="inline-flex h-11 items-center justify-center rounded-md bg-ink text-[14px] font-medium text-ground"
            >
              {signedIn ? NAV_DASHBOARD : NAV_CTA}
            </Link>
            {!signedIn && (
              <Link
                href="/sign-in"
                onClick={() => setOpen(false)}
                className="inline-flex h-11 items-center justify-center rounded-md border border-edge text-[14px] text-ink-2"
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

        {/* Centre group. Hidden under 900px, where the sheet carries all of it.
            `delay` is Base UI's hover-intent: 100ms in stops a panel opening
            because the pointer crossed a trigger on its way to the CTA, and
            200ms out is what makes the diagonal from trigger to panel
            survivable without a pointer-tracking triangle. */}
        <NavigationMenu.Root
          delay={100}
          closeDelay={200}
          className={cn("hidden", "min-[900px]:block")}
        >
          <NavigationMenu.List className="room-menu-list">
            {MENUS.map((menu) => (
              <NavigationMenu.Item key={menu.label} className="px-3.5">
                <NavigationMenu.Trigger className="room-menu-trigger">
                  {menu.label}
                  <NavigationMenu.Icon className="room-menu-icon">
                    <Caret />
                  </NavigationMenu.Icon>
                </NavigationMenu.Trigger>
                {/* keepMounted so the destinations are in the served HTML. The
                    panels are the only place several of these routes are linked
                    from above the footer, and a crawler does not hover. */}
                <NavigationMenu.Content className="room-menu-content" keepMounted>
                  <Panel menu={menu} />
                </NavigationMenu.Content>
              </NavigationMenu.Item>
            ))}

            {FLAT_LINKS.map((link) => (
              <NavigationMenu.Item key={link.href} className="px-3.5">
                <NavigationMenu.Link className={linkClass} style={hover} render={<Link href={link.href} />}>
                  {link.label}
                </NavigationMenu.Link>
              </NavigationMenu.Item>
            ))}
          </NavigationMenu.List>

          <NavigationMenu.Portal>
            <NavigationMenu.Positioner
              className="room-menu-positioner"
              sideOffset={10}
              collisionPadding={16}
            >
              <NavigationMenu.Popup className="room-menu-popup">
                <NavigationMenu.Viewport className="room-menu-viewport" />
              </NavigationMenu.Popup>
            </NavigationMenu.Positioner>
          </NavigationMenu.Portal>
        </NavigationMenu.Root>

        <nav className="room-nav-links">
          {/* Signed OUT this is "Sign in", the quiet counterpart to the CTA's
              "Get started". Signed IN it renders nothing: the CTA beside it has
              become "Dashboard", and two adjacent links to the same page is the
              kind of thing that reads as a bug even when it works. */}
          {!isSignedIn && (
            <span className={cn("room-nav-signin hidden", "min-[900px]:inline-flex")}>
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
            className="inline-flex h-9 shrink-0 items-center rounded-md bg-ink px-4 text-[14px] font-medium text-ground transition-[background-color] hover:bg-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-mark"
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
