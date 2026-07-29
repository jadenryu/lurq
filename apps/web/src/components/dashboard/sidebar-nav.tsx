"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { UserButton } from "@clerk/nextjs";
import { KeyRound, ChartColumnBig, Activity, PackagePlus } from "lucide-react";
import { Logo } from "@/components/common/logo";
import { cn } from "@/lib/utils";

const NAV_ITEMS = [
  { href: "/dashboard", label: "api keys", icon: KeyRound },
  { href: "/dashboard/usage", label: "usage", icon: ChartColumnBig },
  { href: "/dashboard/activity", label: "activity", icon: Activity },
  { href: "/dashboard/contributions", label: "contributions", icon: PackagePlus },
];

function isActive(pathname: string, href: string): boolean {
  return href === "/dashboard" ? pathname === href : pathname.startsWith(href);
}

/**
 * Full-height sidebar on desktop (logo → grouped nav → profile pinned to the
 * bottom); a compact top bar + horizontal tab row on mobile. One client
 * component so both share the active-route logic.
 */
export function DashboardNav() {
  const pathname = usePathname();

  return (
    <>
      {/* Mobile: top bar (logo + account) then a scrollable tab row. */}
      <div className="border-b border-border md:hidden">
        <div className="flex h-16 items-center justify-between px-5">
          <Link href="/" className="transition-opacity hover:opacity-80">
            <Logo />
          </Link>
          <UserButton />
        </div>
        <nav className="flex gap-1 overflow-x-auto px-4 pb-3">
          {NAV_ITEMS.map((item) => {
            const active = isActive(pathname, item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "flex shrink-0 items-center gap-2 rounded-md px-3 py-1.5 font-mono text-sm lowercase tracking-wide transition-colors",
                  active
                    ? "bg-secondary text-foreground"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                <item.icon className="size-4" />
                {item.label}
              </Link>
            );
          })}
        </nav>
      </div>

      {/* Desktop: full-height sticky sidebar. */}
      <aside className="hidden w-64 shrink-0 border-r border-border md:sticky md:top-0 md:flex md:h-screen md:flex-col">
        <div className="px-5 py-6">
          <Link href="/" className="transition-opacity hover:opacity-80">
            <Logo />
          </Link>
        </div>

        <nav className="flex-1 overflow-y-auto px-3">
          <p className="px-3 pb-2 font-mono text-[0.65rem] uppercase tracking-[0.16em] text-muted-foreground/50">
            workspace
          </p>
          <div className="flex flex-col gap-0.5">
            {NAV_ITEMS.map((item) => {
              const active = isActive(pathname, item.href);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "flex items-center gap-3 rounded-md px-3 py-2 font-mono text-sm lowercase tracking-wide transition-colors",
                    active
                      ? "bg-secondary text-foreground"
                      : "text-muted-foreground hover:bg-muted/50 hover:text-foreground",
                  )}
                >
                  <item.icon className="size-4 shrink-0" />
                  {item.label}
                </Link>
              );
            })}
          </div>
        </nav>

        <div className="border-t border-border p-3">
          <UserButton
            showName
            appearance={{ elements: { rootBox: "w-full", userButtonBox: "w-full justify-start gap-3 px-2 py-1.5" } }}
          />
        </div>
      </aside>
    </>
  );
}
