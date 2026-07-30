"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { AccountMenu } from "@/components/dashboard/account-menu";
import { Logo } from "@/components/common/logo";
import { DOCS_URL } from "@/lib/site-links";
import { cn } from "@/lib/utils";

interface NavItem {
  href: string;
  label: string;
  /** Cross-zone or off-site link: render a plain <a> for a real navigation. */
  external?: boolean;
}

const WORKSPACE: NavItem[] = [
  { href: "/dashboard", label: "overview" },
  { href: "/dashboard/keys", label: "api keys" },
  { href: "/dashboard/usage", label: "usage" },
  { href: "/dashboard/activity", label: "activity" },
  { href: "/dashboard/contributions", label: "contributions" },
];

const SUPPORT: NavItem[] = [
  { href: "/dashboard/guide", label: "how to use" },
  { href: DOCS_URL, label: "docs", external: true },
  { href: "/book-demo", label: "support" },
];

/** `/dashboard` is only active on an exact match — every other route is a prefix. */
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
  const className = cn(
    "relative flex items-center rounded-[var(--radius-control)] py-2 pl-4 pr-3 font-mono text-sm lowercase tracking-wide transition-colors",
    active
      ? "bg-secondary text-foreground"
      : "text-muted-foreground hover:bg-muted/50 hover:text-foreground",
  );
  const inner = (
    <>
      {active && (
        <span
          aria-hidden
          className="absolute inset-y-1.5 left-0 w-[2px] rounded-full bg-signal"
        />
      )}
      {item.label}
    </>
  );
  if (item.external) {
    return (
      <a href={item.href} className={className}>
        {inner}
      </a>
    );
  }
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
      <p className="px-4 pb-2 font-mono text-[0.65rem] uppercase tracking-[0.16em] text-muted-foreground/45">
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

  return (
    <>
      {/* Mobile: top bar (logo + account) then a scrollable tab row. */}
      <div className="border-b border-border md:hidden">
        <div className="flex h-16 items-center justify-between gap-3 px-5">
          <Link href="/" className="transition-opacity hover:opacity-80">
            <Logo />
          </Link>
          <div className="w-auto">
            <AccountMenu compact />
          </div>
        </div>
        <nav className="flex gap-1 overflow-x-auto px-4 pb-3">
          {WORKSPACE.map((item) => {
            const active = isActive(pathname, item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "shrink-0 rounded-[var(--radius-control)] border-b-2 px-3 py-1.5 font-mono text-sm lowercase tracking-wide transition-colors",
                  active
                    ? "border-signal bg-secondary text-foreground"
                    : "border-transparent text-muted-foreground hover:text-foreground",
                )}
              >
                {item.label}
              </Link>
            );
          })}
        </nav>
      </div>

      {/* Desktop: full-height sticky sidebar. */}
      <aside className="hidden w-60 shrink-0 border-r border-border md:sticky md:top-0 md:flex md:h-screen md:flex-col">
        <div className="px-5 py-6">
          <Link href="/" className="transition-opacity hover:opacity-80">
            <Logo />
          </Link>
        </div>

        <nav className="flex flex-1 flex-col gap-6 overflow-y-auto px-2">
          <NavGroup label="workspace" items={WORKSPACE} pathname={pathname} />
          <NavGroup label="support" items={SUPPORT} pathname={pathname} />
        </nav>

        <div className="border-t border-border p-2">
          <AccountMenu />
        </div>
      </aside>
    </>
  );
}
