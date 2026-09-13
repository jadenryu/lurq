"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { OrganizationSwitcher, SignInButton, SignUpButton } from "@clerk/nextjs";
import { LayoutGroup, motion, useReducedMotion } from "framer-motion";
import { Lock } from "lucide-react";
import { AccountMenu } from "@/components/dashboard/account-menu";
import { CommandPalette, CommandPaletteTrigger } from "@/components/dashboard/command-palette";
import { Logo } from "@/components/common/logo";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface NavItem {
  href: string;
  label: string;
}

/** The one row a signed-out visitor can open. See proxy.ts. */
const REPORT = "/dashboard/report";

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
  // Where the landing page's scan box lands, so it is also the first page many
  // people ever see in here.
  { href: REPORT, label: "builder report" },
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
 * A row a signed-out visitor can see but not open.
 *
 * Shown rather than hidden: the rail IS the answer to "what else is in here",
 * and a report page with no nav would read as a landing page with a login. The
 * row is a sign-up button that lands them on the page they clicked, so the
 * lock is never a dead end — and proxy.ts, not this button, is what actually
 * keeps the page closed.
 */
function LockedRow({ item, className }: { item: NavItem; className: string }) {
  return (
    <SignUpButton mode="modal" fallbackRedirectUrl={item.href} signInFallbackRedirectUrl={item.href}>
      <button
        type="button"
        aria-label={`${item.label}, sign up to open`}
        className={cn(className, "gap-2 text-ink-3 hover:text-ink-2")}
      >
        {item.label}
        <Lock aria-hidden className="ml-auto size-3 shrink-0 opacity-70" />
      </button>
    </SignUpButton>
  );
}

/**
 * Nav rows carry no icons. A glyph beside "usage" or "activity" adds no
 * information a one-word label doesn't already give, and a column of mismatched
 * pictograms is the fastest way to make a tool look unserious. Identity for the
 * current route comes from an accent rule plus a lifted surface instead. The
 * lock on a signed-out row is the exception, because it is state, not identity.
 */
function NavLink({ item, active, locked }: { item: NavItem; active: boolean; locked: boolean }) {
  const reduce = useReducedMotion();
  const className = cn(
    "relative flex h-[30px] w-full items-center rounded-[var(--radius-control)] pl-3.5 pr-3 text-[13px] lowercase tracking-[-0.005em] transition-colors",
    active
      ? "bg-surface-2 text-ink"
      : "text-ink-2 hover:bg-surface-2/60 hover:text-ink",
  );
  if (locked && item.href !== REPORT) return <LockedRow item={item} className={className} />;

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
          className="absolute inset-y-1 left-0 w-[2px] rounded-full bg-signal"
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
  locked,
}: {
  label: string;
  items: NavItem[];
  pathname: string;
  locked: boolean;
}) {
  return (
    <div>
      <p className="px-3.5 pb-1.5 text-[10.5px] font-medium tracking-[0.07em] uppercase text-ink-3">
        {label}
      </p>
      <div className="flex flex-col gap-px">
        {items.map((item) => (
          <NavLink
            key={item.href}
            item={item}
            active={isActive(pathname, item.href)}
            locked={locked}
          />
        ))}
      </div>
    </div>
  );
}

/** Where the account menu sits, for someone who does not have an account yet. */
function Guest({ compact = false }: { compact?: boolean }) {
  return (
    <div className={cn("flex items-center gap-3", !compact && "justify-between px-1.5 py-1")}>
      <SignInButton mode="modal">
        <button type="button" className="text-[12.5px] text-ink-3 hover:text-ink">
          Log in
        </button>
      </SignInButton>
      <SignUpButton mode="modal">
        <button type="button" className={buttonVariants({ size: "sm" })}>
          Sign up free
        </button>
      </SignUpButton>
    </div>
  );
}

/**
 * Full-height sidebar on desktop (logo → grouped nav → account card pinned to the
 * bottom); a compact top bar + scrollable tab row on mobile. One client component
 * so both share the active-route logic.
 *
 * `locked` is the signed-out render (see app/dashboard/layout.tsx): every row
 * but the builder report is a sign-up, and the palette is gone, because every
 * command in it leads somewhere a visitor cannot go.
 */
export function DashboardNav({ locked = false }: { locked?: boolean }) {
  const pathname = usePathname();
  const reduce = useReducedMotion();
  // The nav owns the palette's open state so both trigger buttons drive one
  // dialog: the mobile bar and the desktop sidebar are both mounted at every
  // viewport (one is hidden by a media query, not unmounted), so a palette per
  // trigger would mean two ⌘K listeners racing each other.
  const [paletteOpen, setPaletteOpen] = useState(false);

  return (
    <>
      {!locked && <CommandPalette open={paletteOpen} onOpenChange={setPaletteOpen} />}

      {/* Mobile: top bar (logo + account) then search, then a scrollable tab row. */}
      <div className="border-b border-border md:hidden">
        <div className="flex h-16 items-center justify-between gap-3 px-5">
          <Link href="/" className="transition-opacity hover:opacity-80">
            <Logo />
          </Link>
          <div className="flex w-auto items-center gap-2">
            {locked ? (
              <Guest compact />
            ) : (
              <>
                <OrganizationSwitcher
                  afterSelectOrganizationUrl="/dashboard"
                  afterSelectPersonalUrl="/dashboard"
                />
                <AccountMenu compact />
              </>
            )}
          </div>
        </div>
        {!locked && (
          <div className="px-4 pb-3">
            <CommandPaletteTrigger onClick={() => setPaletteOpen(true)} className="w-full" />
          </div>
        )}
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
              const className = cn(
                "relative flex shrink-0 snap-start items-center rounded-[var(--radius-control)] px-3 py-1.5 text-sm lowercase tracking-[-0.005em] transition-colors",
                active
                  ? "bg-secondary text-foreground"
                  : "text-muted-foreground hover:text-foreground",
              );
              if (locked && item.href !== REPORT) {
                return <LockedRow key={item.href} item={item} className={className} />;
              }
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  aria-current={active ? "page" : undefined}
                  className={className}
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
      <aside className="hidden w-[216px] shrink-0 border-r border-edge bg-surface/40 md:sticky md:top-0 md:flex md:h-screen md:flex-col">
        <div className="flex h-12 items-center border-b border-edge px-4">
          <Link href="/" className="transition-opacity hover:opacity-80">
            <Logo />
          </Link>
        </div>

        {/* Above the rail, not inside it: it searches what lurq can *do*, which
            is mostly not a page, so listing it as an eighth nav row would file it
            under the one thing it isn't. */}
        {!locked && (
          <div className="px-2.5 py-3">
            <CommandPaletteTrigger onClick={() => setPaletteOpen(true)} className="w-full" />
          </div>
        )}

        <LayoutGroup id="dashboard-nav-desktop">
          <nav className={cn("flex flex-1 flex-col gap-5 overflow-y-auto px-2 pb-4", locked && "pt-3")}>
            <NavGroup label="workspace" items={WORKSPACE} pathname={pathname} locked={locked} />
            <NavGroup label="account" items={ACCOUNT} pathname={pathname} locked={locked} />
          </nav>
        </LayoutGroup>

        <div className="border-t border-edge p-2">
          {locked ? (
            <Guest />
          ) : (
            <>
              {/* Picking an organization makes it the account every dashboard
                  page reads and writes (lib/owner.ts). Personal stays listed so
                  nobody loses their own keys by joining a team. */}
              <OrganizationSwitcher
                afterSelectOrganizationUrl="/dashboard"
                afterSelectPersonalUrl="/dashboard"
                appearance={{ elements: { rootBox: "mb-2 w-full", organizationSwitcherTrigger: "w-full justify-between" } }}
              />
              <AccountMenu />
            </>
          )}
        </div>
      </aside>
    </>
  );
}
