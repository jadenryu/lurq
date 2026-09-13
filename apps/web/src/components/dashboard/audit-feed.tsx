"use client";

import { useMemo, useState } from "react";
import { Search, X } from "lucide-react";
import { CopyButton } from "@/components/dashboard/copy-button";
import { Chip, EmptyState, Panel, columnLabel, microLabel } from "@/components/dashboard/panel";
import { Segmented } from "@/components/dashboard/segmented";
import { auditBrief } from "@/lib/llm-export";
import type { AuditEvent, AuditKind } from "@/lib/audit";
import { relativeTime } from "@/lib/format";
import { cn } from "@/lib/utils";

/**
 * The audit log, as something you can interrogate rather than scroll.
 *
 * It was a flat list of every event ever, newest first, with no way to answer
 * the three questions anybody actually opens a log with: what broke, when, and
 * was it this thing or that thing. A log you can only scroll is a log nobody
 * reads past the first screen — which is the same as not having one.
 *
 * Three axes, because they are independent and people combine them: time
 * ("since yesterday"), kind ("scans, not keys"), and severity ("only what
 * failed"). Each control carries its own count, so narrowing is a decision made
 * with the answer visible rather than a guess that might empty the page.
 *
 * Filtering is client-side on purpose. The whole log is three already-loaded
 * lists composed in memory (see lib/audit.ts) — there is no query behind it to
 * push a filter into, and a round trip per keystroke would be slower and less
 * capable than the array it is filtering.
 */

const RANGES = [
  { value: 1, label: "24h" },
  { value: 7, label: "7d" },
  { value: 30, label: "30d" },
  { value: 0, label: "all" },
] as const;

const KINDS = [
  { value: "all", label: "all" },
  { value: "scan", label: "scans" },
  { value: "alert", label: "alerts" },
  { value: "key", label: "keys" },
] as const;

type RangeValue = (typeof RANGES)[number]["value"];
type KindValue = (typeof KINDS)[number]["value"];
type SeverityValue = "any" | "problems";

const KIND_LABEL: Record<AuditKind, string> = { key: "key", scan: "scan", alert: "alert" };

/** Day key for grouping, in the reader's own timezone. */
function dayOf(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function Row({ event }: { event: AuditEvent }) {
  return (
    <li className="flex flex-wrap items-baseline gap-x-3 gap-y-1 border-b border-edge px-[var(--panel-px)] py-2.5 last:border-b-0 hover:bg-surface-2/50">
      <span className={cn("w-10 shrink-0", columnLabel)}>{KIND_LABEL[event.kind]}</span>
      <span className="min-w-0 flex-1 text-[13px] text-ink">{event.summary}</span>
      {event.tone !== "neutral" && (
        <Chip tone={event.tone === "bad" ? "bad" : "warn"}>
          {event.tone === "bad" ? "action needed" : "review"}
        </Chip>
      )}
      {/* Relative, with the exact stamp on hover. A log is read for "what
          changed recently", which relative time answers directly; the absolute
          time is what you need once you are correlating with something else,
          and that is a deliberate act worth a hover. */}
      <time
        dateTime={event.at}
        title={new Date(event.at).toISOString()}
        className="shrink-0 font-mono text-[11px] tabular-nums text-ink-3"
      >
        {relativeTime(event.at)}
      </time>
      {event.detail && (
        <p className="w-full pl-[3.25rem] text-[12.5px] leading-relaxed text-ink-2">
          {event.detail}
        </p>
      )}
    </li>
  );
}

export function AuditFeed({
  events,
  /**
   * The server's clock, passed in rather than read here.
   *
   * `Date.now()` in render is impure — the React compiler rejects it outright,
   * and it would give the first paint and every re-render slightly different
   * cutoffs. One timestamp per request, stable for the life of the view.
   */
  now,
}: {
  events: AuditEvent[];
  now: number;
}) {
  const [range, setRange] = useState<RangeValue>(0);
  const [kind, setKind] = useState<KindValue>("all");
  const [severity, setSeverity] = useState<SeverityValue>("any");
  const [query, setQuery] = useState("");

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    const cutoff = range === 0 ? 0 : now - range * 24 * 60 * 60 * 1000;
    return events.filter((e) => {
      if (cutoff && Date.parse(e.at) < cutoff) return false;
      if (kind !== "all" && e.kind !== kind) return false;
      if (severity === "problems" && e.tone === "neutral") return false;
      if (!q) return true;
      return (
        e.summary.toLowerCase().includes(q) || (e.detail ?? "").toLowerCase().includes(q)
      );
    });
  }, [events, now, range, kind, severity, query]);

  /**
   * Counts for the controls, each computed against the *other* two filters.
   *
   * A count that ignores the rest of the filter promises rows that aren't there
   * ("scans: 12" next to an empty list); a count that includes its own axis
   * would just repeat the visible total on the selected cell and read zero
   * everywhere else. Counting the siblings is the version that answers "what
   * happens if I click this".
   */
  const counts = useMemo(() => {
    const cutoff = range === 0 ? 0 : now - range * 24 * 60 * 60 * 1000;
    const inTime = events.filter((e) => !cutoff || Date.parse(e.at) >= cutoff);
    const bySeverity = inTime.filter((e) => severity !== "problems" || e.tone !== "neutral");
    const byKind = inTime.filter((e) => kind === "all" || e.kind === kind);
    return {
      kind: {
        all: bySeverity.length,
        scan: bySeverity.filter((e) => e.kind === "scan").length,
        alert: bySeverity.filter((e) => e.kind === "alert").length,
        key: bySeverity.filter((e) => e.kind === "key").length,
      } as Record<KindValue, number>,
      problems: byKind.filter((e) => e.tone !== "neutral").length,
    };
  }, [events, now, range, kind, severity]);

  /** Newest first, split into days, so scanning has a rhythm to land on. */
  const days = useMemo(() => {
    const out: { day: string; events: AuditEvent[] }[] = [];
    for (const event of visible) {
      const day = dayOf(event.at);
      const last = out[out.length - 1];
      if (last?.day === day) last.events.push(event);
      else out.push({ day, events: [event] });
    }
    return out;
  }, [visible]);

  const problemCount = visible.filter((e) => e.tone !== "neutral").length;
  const activeRange = RANGES.find((r) => r.value === range)!.label;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[11rem] flex-1 sm:max-w-xs">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-ink-3" />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search events…"
            aria-label="Search events"
            className="h-8 w-full rounded-[var(--radius-control)] border border-edge bg-surface pl-9 pr-8 font-mono text-xs text-ink placeholder:text-ink-3 focus-visible:border-signal/50 focus-visible:outline-none [&::-webkit-search-cancel-button]:appearance-none"
          />
          {query && (
            <button
              type="button"
              onClick={() => setQuery("")}
              aria-label="Clear search"
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-ink-3 transition-colors hover:text-ink"
            >
              <X className="size-3.5" />
            </button>
          )}
        </div>

        <Segmented
          label="Time range"
          value={range}
          onChange={setRange}
          options={RANGES.map((r) => ({ value: r.value, label: r.label }))}
        />
        <Segmented
          label="Event kind"
          value={kind}
          onChange={setKind}
          options={KINDS.map((k) => ({ value: k.value, label: k.label, meta: counts.kind[k.value] }))}
        />
        <Segmented
          label="Severity"
          value={severity}
          onChange={setSeverity}
          options={[
            { value: "any" as const, label: "any" },
            { value: "problems" as const, label: "needs attention", meta: counts.problems },
          ]}
        />

        <div className="ml-auto flex items-center gap-3">
          <p aria-live="polite" className={microLabel}>
            {visible.length.toLocaleString()} event{visible.length === 1 ? "" : "s"}
            {problemCount > 0 && ` · ${problemCount} need attention`}
          </p>
          {/* Exports exactly what is on screen. An export that silently
              re-widens to the whole log is a different document from the one
              the reader narrowed to. */}
          <CopyButton
            label="Copy for agent"
            copiedLabel="Copied"
            variant="ghost"
            text={auditBrief(visible, {
              range: activeRange === "all" ? "all time" : `last ${activeRange}`,
              kind,
              severity: severity === "problems" ? "needing attention only" : "any severity",
              query: query.trim(),
            })}
          />
        </div>
      </div>

      {visible.length === 0 ? (
        <EmptyState title="Nothing matches these filters">
          {events.length === 0
            ? "Keys you create, repositories lurq scans, and releases that affect them all land here."
            : "Widen the time range, or clear the search."}
        </EmptyState>
      ) : (
        <Panel padding="none">
          {days.map(({ day, events: dayEvents }) => (
            <section key={day}>
              <h2
                className={cn(
                  "flex items-baseline justify-between gap-3 border-b border-edge bg-surface-2/60 px-[var(--panel-px)] py-1.5",
                  columnLabel,
                )}
              >
                <span>{day}</span>
                <span className="tabular-nums">{dayEvents.length}</span>
              </h2>
              <ul>
                {dayEvents.map((event) => (
                  <Row key={event.id} event={event} />
                ))}
              </ul>
            </section>
          ))}
        </Panel>
      )}
    </div>
  );
}
