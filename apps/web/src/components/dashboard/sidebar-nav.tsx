"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

const NAV_ITEMS = [
  { href: "/dashboard", label: "api keys" },
  { href: "/dashboard/usage", label: "usage" },
  { href: "/dashboard/activity", label: "activity" },
  { href: "/dashboard/contributions", label: "contributions" },
];

function isActive(pathname: string, href: string): boolean {
  return href === "/dashboard" ? pathname === href : pathname.startsWith(href);
}

/** Renders both a mobile top-tab row and a desktop sidebar; CSS picks one per breakpoint. */
export function DashboardNav() {
  const pathname = usePathname();

  return (
    <>
      <nav className="flex gap-1 overflow-x-auto border-b border-border px-4 py-3 md:hidden">
        {NAV_ITEMS.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            className={cn(
              "shrink-0 rounded-md px-3 py-1.5 font-mono text-sm lowercase tracking-wide transition-colors",
              isActive(pathname, item.href)
                ? "bg-secondary text-foreground"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {item.label}
          </Link>
        ))}
      </nav>
      <aside className="hidden w-56 shrink-0 border-r border-border py-10 md:block">
        <p className="px-6 pb-3 font-mono text-[0.65rem] uppercase tracking-[0.16em] text-muted-foreground/50">
          dashboard
        </p>
        <nav className="flex flex-col gap-0.5 px-3">
          {NAV_ITEMS.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              aria-current={isActive(pathname, item.href) ? "page" : undefined}
              className={cn(
                "rounded-md px-3 py-2 font-mono text-sm lowercase tracking-wide transition-colors",
                isActive(pathname, item.href)
                  ? "bg-secondary text-foreground"
                  : "text-muted-foreground hover:bg-muted/50 hover:text-foreground",
              )}
            >
              {item.label}
            </Link>
          ))}
        </nav>
      </aside>
    </>
  );
}
