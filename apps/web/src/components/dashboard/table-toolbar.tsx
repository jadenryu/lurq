"use client";

import { Search, X } from "lucide-react";
import { Segmented } from "@/components/dashboard/segmented";
import { cn } from "@/lib/utils";

/**
 * One filter row, sitting above the table it scopes (never inside a card, and
 * never one set of controls per table section). Search on the left, mutually
 * exclusive state chips next to it, live result count pinned right.
 */
export function TableToolbar({
  query,
  onQueryChange,
  placeholder = "Search…",
  filters,
  activeFilter,
  onFilterChange,
  count,
  noun,
}: {
  query: string;
  onQueryChange: (v: string) => void;
  placeholder?: string;
  filters?: { id: string; label: string }[];
  activeFilter?: string;
  onFilterChange?: (id: string) => void;
  count: number;
  noun: string;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="relative min-w-[12rem] flex-1 sm:max-w-xs">
        <Search className="pointer-events-none absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-ink-3" />
        <input
          type="search"
          value={query}
          onChange={(e) => onQueryChange(e.target.value)}
          placeholder={placeholder}
          aria-label={placeholder}
          className={cn(
            "h-8 w-full rounded-[var(--radius-control)] border border-edge bg-surface pl-9 pr-8 font-mono text-xs",
            "placeholder:text-ink-3 focus-visible:border-signal/50 focus-visible:outline-none",
            "[&::-webkit-search-cancel-button]:appearance-none",
          )}
        />
        {query && (
          <button
            type="button"
            onClick={() => onQueryChange("")}
            aria-label="Clear search"
            className="absolute right-2.5 top-1/2 -translate-y-1/2 text-ink-3 transition-colors hover:text-foreground"
          >
            <X className="size-3.5" />
          </button>
        )}
      </div>

      {filters && onFilterChange && (
        <Segmented
          label="Filter"
          value={activeFilter ?? filters[0]!.id}
          onChange={onFilterChange}
          options={filters.map((f) => ({ value: f.id, label: f.label }))}
        />
      )}

      <p
        aria-live="polite"
        className="ml-auto font-mono text-xs tabular-nums text-ink-3"
      >
        {count.toLocaleString()} {noun}
        {count === 1 ? "" : "s"}
      </p>
    </div>
  );
}

/** Shared header-cell styling so every dashboard table matches. */
export { columnLabel as thClass } from "@/components/dashboard/panel";
