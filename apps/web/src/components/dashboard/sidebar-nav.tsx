"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

const NAV_ITEMS = [
  { href: "/dashboard", label: "api keys" },
  { href: "/dashboard/activity", label: "activity" },
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
      <aside className="hidden w-52 shrink-0 border-r border-border py-8 md:block">
        <nav className="flex flex-col gap-1 px-3">
          {NAV_ITEMS.map((item) => (
            <Link
              key={item.href}
              href={item.href}
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
