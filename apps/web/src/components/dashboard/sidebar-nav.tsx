"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { LayoutGroup, motion, useReducedMotion } from "framer-motion";
import { AccountMenu } from "@/components/dashboard/account-menu";
import { CommandPalette, CommandPaletteTrigger } from "@/components/dashboard/command-palette";
import { Logo } from "@/components/common/logo";
import { cn } from "@/lib/utils";

interface NavItem {
  href: string;
  label: string;
}

/**
 * Two groups, split by who the row is about.
 *
 * The rail used to be one seven-row "workspace" group plus a "support" group,
 * which put "api keys" (a credential belonging to one person) in the same list
 * as "policy" (a rule binding every repo in the account). The split now runs on
 * that line: workspace is the thing being governed, account is the person doing
 * the governing. It is the division a reader can predict before they read the
 * rows, which is the only property a nav grouping has to have.
 *
 * TWO ROWS ARE RELABELLED, NOT MOVED. `/dashboard/repos` is "autopilot" and
 * `/dashboard/usage` is "credits". Both keep their URLs, so the GitHub OAuth
 * callback, the alerts and conformance panels, getting-started, the overview's
 * "usage detail" link and `capabilities.ts` all keep working untouched. A label
 * is a word in one file; a route is a contract with six callers and a published
 * docs page.
 */
const WORKSPACE: NavItem[] = [
  { href: "/dashboard", label: "overview" },
  // The repositories page: connect a repo, scan it, let lurq keep it current.
  // "autopilot" is what the page has always been for — the per-repo section is
  // already anchored `#autopilot` — and it names the outcome instead of the
  // noun.
  { href: "/dashboard/repos", label: "autopilot" },
  { href: "/dashboard/policy", label: "policy" },
  { href: "/dashboard/audit", label: "audit log" },
  { href: "/dashboard/contributions", label: "contributions" },
];

const ACCOUNT: NavItem[] = [
  { href: "/dashboard/profile", label: "profile" },
  { href: "/dashboard/activity", label: "activity" },
  // Metered API consumption: the year map, the trend, the per-tool split.
  // "credits" is what the reader is actually spending.
  { href: "/dashboard/usage", label: "credits" },
  // Directly under credits, because "how much have I used" and "what am I paying
  // for it" are one question asked twice. Until now nothing linked here at all:
  // the page existed but was reachable only via Stripe's post-checkout redirect,
  // so anyone who wanted to change a card or cancel had no route to it. An
  // unreachable cancellation path is not merely awkward — it is the thing every
  // processor requires you to provide.
  { href: "/dashboard/billing", label: "billing" },
  { href: "/dashboard/notifications", label: "notifications" },
  { href: "/dashboard/preferences", label: "preferences" },
  // Sixth row, and the one place a reader can get back to a key they closed the
  // tab on. `lurq setup` opens this URL and the docs quickstart links straight
  // to it, so it has to be findable from inside the product too.
  { href: "/dashboard/keys", label: "api keys" },
  { href: "/dashboard/support", label: "support" },
];

/** Both rails, in reading order. The mobile tab row is one flat list. */
const ALL: NavItem[] = [...WORKSPACE, ...ACCOUNT];

/** `/dashboard` is only active on an exact match, every other route is a prefix. */
function isActive(pathname: string, href: string): boolean {
  return href === "/dashboard" ? pathname === href : pathname.startsWith(href);
}

/**
 * Nav rows carry no icons. A glyph beside "usage" or "activity" adds no
 * information a one-word label doesn't already give, and a column of mismatched
 * pictograms is the fastest way to make a tool look unserious. Identity for the
 * current route comes from an accent rule plus a lifted surface instead.
 */
function NavLink({ item, active }: { item: NavItem; active: boolean }) {
  const reduce = useReducedMotion();
  const className = cn(
    "relative flex items-center rounded-[var(--radius-control)] py-2 pl-4 pr-3 text-sm lowercase tracking-[-0.005em] transition-colors",
    active
      ? "bg-secondary text-foreground"
      : "text-muted-foreground hover:bg-muted/50 hover:text-foreground",
  );
  const inner = (
    <>
      {/* One indicator for the whole rail, not one per row. `layoutId` makes
          framer treat the rule on the outgoing row and the rule on the incoming
          row as the SAME element, so it travels between them instead of the old
          one vanishing and a new one appearing. That movement is the thing that
          tells you where you went — which is why it is the one piece of motion
          in the sidebar worth having.

          Under reduced motion the indicator still moves (it has to mark the
          current route) but arrives instantly. */}
      {active && (
        <motion.span
          layoutId="dashboard-nav-indicator"
          aria-hidden
          className="absolute inset-y-1.5 left-0 w-[2px] rounded-full bg-signal"
          transition={
            reduce ? { duration: 0 } : { type: "spring", stiffness: 520, damping: 42, mass: 0.7 }
          }
        />
      )}
      {item.label}
    </>
  );
  return (
    <Link href={item.href} aria-current={active ? "page" : undefined} className={className}>
      {inner}
    </Link>
  );
}

function NavGroup({
  label,
  items,
  pathname,
}: {
  label: string;
  items: NavItem[];
  pathname: string;
}) {
  return (
    <div>
      <p className="px-4 pb-2 text-[11px] font-medium tracking-[0.04em] uppercase text-ink-3">
        {label}
      </p>
      <div className="flex flex-col gap-0.5">
        {items.map((item) => (
          <NavLink key={item.href} item={item} active={isActive(pathname, item.href)} />
        ))}
      </div>
    </div>
  );
}

/**
 * Full-height sidebar on desktop (logo → grouped nav → account card pinned to the
 * bottom); a compact top bar + scrollable tab row on mobile. One client component
 * so both share the active-route logic.
 */
export function DashboardNav() {
  const pathname = usePathname();
  const reduce = useReducedMotion();
  // The nav owns the palette's open state so both trigger buttons drive one
  // dialog: the mobile bar and the desktop sidebar are both mounted at every
  // viewport (one is hidden by a media query, not unmounted), so a palette per
  // trigger would mean two ⌘K listeners racing each other.
  const [paletteOpen, setPaletteOpen] = useState(false);

  return (
    <>
      <CommandPalette open={paletteOpen} onOpenChange={setPaletteOpen} />

      {/* Mobile: top bar (logo + account) then search, then a scrollable tab row. */}
      <div className="border-b border-border md:hidden">
        <div className="flex h-16 items-center justify-between gap-3 px-5">
          <Link href="/" className="transition-opacity hover:opacity-80">
            <Logo />
          </Link>
          <div className="w-auto">
            <AccountMenu compact />
          </div>
        </div>
        <div className="px-4 pb-3">
          <CommandPaletteTrigger onClick={() => setPaletteOpen(true)} className="w-full" />
        </div>
        {/* Its own LayoutGroup and its own layoutId. The mobile bar and the
            desktop sidebar are both in the DOM at all times — one is hidden by a
            media query, not unmounted — so sharing one id would give framer two
            live elements claiming to be the same thing. */}
        <LayoutGroup id="dashboard-nav-mobile">
          <nav className="flex snap-x snap-mandatory gap-1 overflow-x-auto overscroll-x-contain px-4 pb-3 [-webkit-overflow-scrolling:touch] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            {/* Both groups, flat. A mobile tab row has no room for two headings
                and no need for them: the row is already ordered workspace-then-
                account, and it scrolls. */}
            {ALL.map((item) => {
              const active = isActive(pathname, item.href);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "relative shrink-0 snap-start rounded-[var(--radius-control)] px-3 py-1.5 text-sm lowercase tracking-[-0.005em] transition-colors",
                    active
                      ? "bg-secondary text-foreground"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  {active && (
                    <motion.span
                      layoutId="dashboard-nav-indicator-mobile"
                      aria-hidden
                      className="absolute inset-x-2 bottom-0 h-[2px] rounded-full bg-signal"
                      transition={
                        reduce
                          ? { duration: 0 }
                          : { type: "spring", stiffness: 520, damping: 42, mass: 0.7 }
                      }
                    />
                  )}
                  {item.label}
                </Link>
              );
            })}
          </nav>
        </LayoutGroup>
      </div>

      {/* Desktop: full-height sticky sidebar. */}
      <aside className="hidden w-60 shrink-0 border-r border-border md:sticky md:top-0 md:flex md:h-screen md:flex-col">
        <div className="px-5 pb-4 pt-6">
          <Link href="/" className="transition-opacity hover:opacity-80">
            <Logo />
          </Link>
        </div>

        {/* Above the rail, not inside it: it searches what lurq can *do*, which
            is mostly not a page, so listing it as an eighth nav row would file it
            under the one thing it isn't. */}
        <div className="px-3 pb-4">
          <CommandPaletteTrigger onClick={() => setPaletteOpen(true)} className="w-full" />
        </div>

        <LayoutGroup id="dashboard-nav-desktop">
          <nav className="flex flex-1 flex-col gap-6 overflow-y-auto px-2">
            <NavGroup label="workspace" items={WORKSPACE} pathname={pathname} />
            <NavGroup label="account" items={ACCOUNT} pathname={pathname} />
          </nav>
        </LayoutGroup>

        <div className="border-t border-border p-2">
          <AccountMenu />
        </div>
      </aside>
    </>
  );
}
