"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

/**
 * The three faces of the upkeep layer: what you depend on, what the autopilot
 * did about it, and what your agents connect to.
 *
 * Tabs rather than three rail rows. The rail answers "which product am I in";
 * within one product, the sections are peers and the reader switches between
 * them constantly — arm a repository, then look at whether a run happened. As
 * separate destinations that round trip went through the rail every time, and
 * neither page admitted the other existed.
 */
const TABS = [
  { href: "/dashboard/repos", label: "repositories", key: "repos" },
  { href: "/dashboard/runs", label: "runs", key: "runs" },
  { href: "/dashboard/mcp", label: "mcp servers", key: "mcp" },
] as const;

export type UpkeepCounts = Partial<Record<(typeof TABS)[number]["key"], number>>;

/**
 * `counts` is what is WAITING ON A PERSON, not how much of a thing exists.
 *
 * A badge reading "12 servers" is decoration — it is the same number every day
 * and teaches the reader to ignore the badge. Open pull requests and
 * unacknowledged contract changes both mean someone has to look, and they go
 * back to nothing when that happens, which is what makes a count worth reading.
 */
export function UpkeepTabs({ counts = {} }: { counts?: UpkeepCounts }) {
  const pathname = usePathname();
  return (
    <nav aria-label="Upkeep sections" className="-mt-1 mb-4 flex gap-1 overflow-x-auto">
      {TABS.map((tab) => {
        // Prefix, so a repository's own page keeps "repositories" lit rather
        // than dropping the reader into a hub with nothing selected.
        const active = pathname === tab.href || pathname.startsWith(`${tab.href}/`);
        return (
          <Link
            key={tab.href}
            href={tab.href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "shrink-0 rounded-[var(--radius-control)] px-2.5 py-1.5 text-[13px] transition-colors",
              active ? "bg-surface-2 text-ink" : "text-ink-3 hover:bg-muted/40 hover:text-ink-2",
            )}
          >
            {tab.label}
            {counts[tab.key] ? (
              <span className="ml-1.5 rounded-[3px] bg-signal/15 px-1.5 py-px font-mono text-[11px] text-ink">
                {counts[tab.key]}
              </span>
            ) : null}
          </Link>
        );
      })}
    </nav>
  );
}
