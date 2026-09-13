"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { searchCapabilities, type Capability } from "@lurq/core/capabilities";
import { cn } from "@/lib/utils";

/**
 * Ask lurq what lurq can do, and go straight there.
 *
 * The dashboard's real navigation problem is not finding a page — there are
 * seven — it is that most of what lurq does is not a page at all. `check-upgrade`,
 * `check-release` and the surface diff live in a terminal or inside an agent, so
 * a user whose question is "can this tell me if an upgrade will break us" has
 * nowhere in the UI to ask it. A nav rail cannot answer that. A box you type the
 * question into can.
 *
 * It searches the same catalog the MCP `capabilities` tool and `lurq can` read
 * (`src/core/capabilities.ts`), imported directly rather than fetched: it is a
 * dependency-free module of static product metadata, so the whole index ships in
 * the bundle and every keystroke is matched locally. No request per character,
 * no spinner, and it still works while the API is down — which matters, because
 * "what can lurq do" is exactly the question someone asks when nothing else on
 * the page is loading.
 *
 * Each row's action is the thing itself, never an explanation of it: pages
 * navigate, commands and tool names copy to the clipboard.
 */

/** What Enter does on a row, and what the row's right-hand hint says. */
function actionOf(c: Capability): { kind: "open" | "copy"; label: string; value: string } {
  if (c.page) return { kind: "open", label: "open", value: c.page };
  if (c.cli) return { kind: "copy", label: "copy", value: c.cli };
  return { kind: "copy", label: "copy", value: c.mcp ?? "" };
}

type Row = { kind: "capability"; c: Capability } | { kind: "ask" };

export function CommandPalette({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const [copied, setCopied] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const matches = useMemo(() => searchCapabilities(query, 6), [query]);

  /** Every open/close goes through here, so a reopened palette always starts
   *  fresh instead of resuming the last search. Reset on the event rather than
   *  in an effect watching `open` — that would be a second render pass to undo
   *  state we already knew was stale at the moment it closed. */
  const change = useCallback(
    (next: boolean) => {
      setQuery("");
      setActive(0);
      setCopied(null);
      onOpenChange(next);
    },
    [onOpenChange],
  );

  // ⌘K from anywhere in the dashboard. Mounted once (the nav owns the state and
  // both trigger buttons share it), so there is exactly one listener and the
  // shortcut can't toggle twice on a viewport where both nav variants are in the
  // DOM.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() === "k" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        change(!open);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, change]);

  const run = useCallback(
    (c: Capability) => {
      const action = actionOf(c);
      if (action.kind === "open") {
        change(false);
        router.push(action.value);
        return;
      }
      // Clipboard can reject (permissions, insecure origin). Failing silently
      // would leave the row looking like it did nothing, so the copied state is
      // only set once the write actually resolves.
      void navigator.clipboard
        .writeText(action.value)
        .then(() => setCopied(c.id))
        .catch(() => setCopied(null));
    },
    [change, router],
  );

  const trimmed = query.trim();

  /** Ask gets its own page: an agent's answer needs room to stream and has to
   *  survive the palette closing. The palette only hands the question over. */
  const askNow = () => {
    change(false);
    router.push(`/dashboard/ask?q=${encodeURIComponent(trimmed)}`);
  };

  /** Ask needs a real question, not a stray keystroke. */
  const canAsk = trimmed.length > 8;
  /**
   * Two modes, one box, and Enter has to pick the right one.
   *
   * Almost every sentence shares a word with some catalog entry, so "which repo
   * is worst off" used to preselect "connect a repo" and Enter copied a command
   * nobody asked for. Something that reads as a question — a "?" or three words
   * — now puts Ask first. A keyword still lands on the catalog, and the other
   * mode is always one arrow away (or ⌘⏎, which always asks).
   *
   * ponytail: word-count heuristic, not intent classification. If it misfires
   * in practice, score the top match against the query length instead.
   */
  const isQuestion = canAsk && (trimmed.endsWith("?") || trimmed.split(/\s+/).length >= 3);
  /** No keyword hit means the catalog returned its generic first six, which
   *  answer nothing. */
  const results = canAsk && !matches.some((c) => c.score > 0) ? [] : matches;
  const caps: Row[] = results.map((c) => ({ kind: "capability", c }));
  const rows: Row[] = !canAsk
    ? caps
    : isQuestion
      ? [{ kind: "ask" }, ...caps]
      : [...caps, { kind: "ask" }];

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      setActive((i) => {
        const next = e.key === "ArrowDown" ? i + 1 : i - 1;
        return (next + rows.length) % Math.max(rows.length, 1);
      });
      return;
    }
    if (e.key === "Enter") {
      e.preventDefault();
      if (e.metaKey || e.ctrlKey) {
        if (trimmed) askNow();
        return;
      }
      const row = rows[active];
      if (row?.kind === "ask") askNow();
      else if (row) run(row.c);
    }
  };

  // Keep the highlighted row in view when the keyboard walks past the fold.
  useEffect(() => {
    listRef.current?.children[active]?.scrollIntoView({ block: "nearest" });
  }, [active]);

  return (
    <Dialog open={open} onOpenChange={change}>
      <DialogContent
        showCloseButton={false}
        // Anchored high rather than centred: the list grows downward as you
        // type, and a vertically-centred palette makes the whole thing jump on
        // every keystroke.
        className="top-[12vh] max-h-[76vh] w-full max-w-xl translate-y-0 gap-0 overflow-hidden p-0 sm:max-w-xl"
      >
        <DialogTitle className="sr-only">Search what lurq can do</DialogTitle>

        <div className="flex items-center gap-3 border-b border-border px-4">
          <span className="text-sm text-ink-3" aria-hidden>
            ›
          </span>
          <input
            autoFocus
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setActive(0);
            }}
            onKeyDown={onKeyDown}
            placeholder="go somewhere, or ask a question"
            aria-label="Search what lurq can do, or ask a question"
            className="h-12 flex-1 bg-transparent text-sm outline-none placeholder:text-ink-3"
          />
        </div>

        <div ref={listRef} role="listbox" className="max-h-[52vh] overflow-y-auto p-2">
          {rows.map((row, i) => {
            const className = cn(
              "flex w-full items-start gap-3 rounded-[var(--radius-control)] px-3 py-2.5 text-left transition-colors",
              i === active ? "bg-secondary" : "hover:bg-muted/50",
            );
            if (row.kind === "ask") {
              return (
                <button
                  key="ask"
                  role="option"
                  aria-selected={i === active}
                  onClick={askNow}
                  onMouseMove={() => setActive(i)}
                  className={className}
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm text-foreground">
                      <span className="text-signal">ask</span> “{trimmed}”
                    </p>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      An agent reads the index and your account, and answers from what it finds.
                    </p>
                  </div>
                  <span className="shrink-0 text-[11px] font-medium tracking-[0.04em] uppercase text-ink-3">
                    ask
                  </span>
                </button>
              );
            }
            const { c } = row;
            const action = actionOf(c);
            return (
              <button
                key={c.id}
                role="option"
                aria-selected={i === active}
                onClick={() => run(c)}
                onMouseMove={() => setActive(i)}
                className={className}
              >
                <div className="min-w-0 flex-1">
                  <p className="text-sm text-foreground">{c.title}</p>
                  <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">{c.answer}</p>
                  {(c.cli || c.mcp) && (
                    <p className="mt-1.5 truncate font-mono text-[0.7rem] text-ink-3">
                      {c.cli ?? `${c.mcp} (mcp tool)`}
                    </p>
                  )}
                </div>
                <span className="shrink-0 text-[11px] font-medium tracking-[0.04em] uppercase text-ink-3">
                  {copied === c.id ? "copied" : action.label}
                </span>
              </button>
            );
          })}
        </div>

        <div className="flex items-center justify-between border-t border-border px-4 py-2.5 text-[11px] font-medium tracking-[0.04em] uppercase text-ink-3">
          <span>↑↓ move · ⏎ run · ⌘⏎ ask · esc close</span>
          <span className="hidden sm:inline">your agent can ask this too: the `capabilities` tool</span>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/** The visible affordance. Rendered in both nav variants, sharing one dialog. */
export function CommandPaletteTrigger({
  onClick,
  className,
}: {
  onClick: () => void;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        // Same 1px ring as the account menu at the foot of this rail, so focus
        // reads as one even line on all four sides rather than a detached halo.
        "flex items-center gap-2 rounded-[var(--radius-control)] border border-border px-3 py-2 text-xs text-muted-foreground outline-none transition-colors hover:border-signal/45 hover:text-foreground focus-visible:ring-1 focus-visible:ring-signal/40",
        className,
      )}
    >
      <span aria-hidden>›</span>
      <span className="flex-1 text-left">search or ask</span>
      {/* Hidden where it would be a lie: a phone has no ⌘K. */}
      <kbd className="hidden rounded-sm border border-border px-1.5 py-0.5 text-[0.65rem] md:inline">
        ⌘K
      </kbd>
    </button>
  );
}
