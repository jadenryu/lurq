"use client";

import { useState, useTransition } from "react";
import { setDefaultRange } from "@/app/dashboard/preferences/actions";
import { Panel, PanelHeader } from "@/components/dashboard/panel";
import { RANGES } from "@/components/dashboard/range-tabs";
import { cn } from "@/lib/utils";

/**
 * Saves on click, with no Save button.
 *
 * A settings page with one control and a Save button has two states to get
 * wrong (dirty and saved) for a value that takes one request to write. The
 * optimistic value is held locally so the tab moves under the cursor
 * immediately, and `useTransition` keeps the row disabled until the action
 * returns — long enough to be honest about a slow write, short enough that
 * nobody sees it on a fast one.
 *
 * On failure the tab snaps back to what the server still holds, which is the
 * only truthful thing to show: silently keeping a selection the server rejected
 * is how a preferences page starts lying about itself.
 */
export function PreferencesForm({ defaultRangeDays }: { defaultRangeDays: number }) {
  const [days, setDays] = useState(defaultRangeDays);
  const [pending, startTransition] = useTransition();

  function choose(next: number) {
    if (next === days) return;
    const previous = days;
    setDays(next);
    startTransition(async () => {
      const { ok } = await setDefaultRange(next);
      if (!ok) setDays(previous);
    });
  }

  return (
    <Panel>
      <PanelHeader title="default time range" />
      <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
        The window the credits page opens on. It still takes a{" "}
        <code className="font-mono text-foreground">?days=</code> parameter, so a link you were
        sent always wins over this.
      </p>
      <div className="mt-4 flex items-center gap-1.5" role="group" aria-label="Default time range">
        {RANGES.map((r) => {
          const selected = r.days === days;
          return (
            <button
              key={r.days}
              type="button"
              onClick={() => choose(r.days)}
              disabled={pending}
              aria-pressed={selected}
              className={cn(
                "h-9 rounded-[var(--radius-control)] border px-3 font-mono text-xs transition-colors disabled:opacity-60",
                selected
                  ? "border-signal/45 bg-signal/10 text-foreground"
                  : "border-border text-muted-foreground hover:text-foreground",
              )}
            >
              {r.label}
            </button>
          );
        })}
      </div>
    </Panel>
  );
}
