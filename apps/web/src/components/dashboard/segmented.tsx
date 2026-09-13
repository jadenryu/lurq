"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * One segmented control, for every set of mutually exclusive options.
 *
 * There were three of these, spelled differently: the usage page's range tabs
 * (links, `h-9`, signal-tinted when active), the table toolbar's filters
 * (buttons, `h-9`, same tint), and the policy editor's numeric presets (buttons,
 * `h-8`, raised-when-active). Same control, same job, three appearances — which
 * is the kind of drift a reader registers as sloppiness without being able to
 * name it, because they never see two of them side by side.
 *
 * The shared treatment is an inset track with the selected cell lifted *out* of
 * it: a set where picking one un-picks the others should look like one object,
 * not like N outlined buttons that happen to sit near each other. Active state
 * is carried by surface and elevation rather than by an accent tint, which keeps
 * the one accent colour for things that are actually data.
 *
 * Two shapes because the two behaviours differ in kind, not in style:
 * `Segmented` holds client state, `SegmentedLinks` navigates, so a server page
 * can own the filter in its URL and stay shareable.
 */

const TRACK =
  "inline-flex h-8 shrink-0 items-center gap-0.5 rounded-[var(--radius-control)] border border-edge bg-surface-2 p-0.5";

const CELL =
  "rounded-[3px] px-2.5 text-[12px] font-medium leading-7 tabular-nums transition-colors outline-none focus-visible:ring-1 focus-visible:ring-signal/60";

const ON = "bg-surface text-ink shadow-[0_1px_0_0_var(--edge-lit)]";
const OFF = "text-ink-3 hover:text-ink";

export interface SegmentedOption<T extends string | number> {
  value: T;
  label: ReactNode;
  /** Shown after the label at lower contrast — a count, a unit. */
  meta?: ReactNode;
}

export function Segmented<T extends string | number>({
  options,
  value,
  onChange,
  label,
  className,
  disabled,
}: {
  options: SegmentedOption<T>[];
  value: T;
  onChange: (next: T) => void;
  /** Accessible name for the group, e.g. "Time range". */
  label: string;
  className?: string;
  disabled?: boolean;
}) {
  return (
    <div className={cn(TRACK, className)} role="group" aria-label={label}>
      {options.map((option) => {
        const on = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            disabled={disabled}
            aria-pressed={on}
            onClick={() => onChange(option.value)}
            className={cn(CELL, on ? ON : OFF, disabled && "opacity-60")}
          >
            {option.label}
            {option.meta != null && (
              <span className={cn("ml-1.5", on ? "text-ink-3" : "text-ink-3/70")}>
                {option.meta}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

/**
 * The same control as links, for a filter the server owns.
 *
 * Rendered as real links so the whole page re-reads for the new value: no client
 * state, and the view is shareable and bookmarkable — which is what you want the
 * moment someone pastes "the last 90 days of my audit log" into a ticket.
 */
export function SegmentedLinks({
  options,
  active,
  label,
  className,
}: {
  options: { value: string | number; label: ReactNode; href: string }[];
  active: string | number;
  label: string;
  className?: string;
}) {
  return (
    <div className={cn(TRACK, className)} role="group" aria-label={label}>
      {options.map((option) => {
        const on = option.value === active;
        return (
          <Link
            key={option.value}
            href={option.href}
            aria-current={on ? "true" : undefined}
            className={cn(CELL, on ? ON : OFF)}
          >
            {option.label}
          </Link>
        );
      })}
    </div>
  );
}
