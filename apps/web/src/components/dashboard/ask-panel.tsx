"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Panel } from "@/components/dashboard/panel";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * Ask, as a page instead of a row inside the ⌘K palette.
 *
 * In the palette an answer streamed into a box sized for a search hit, and the
 * dialog reset on close, so twenty seconds of tool calls vanished the moment
 * you clicked away. Here the answers stay put: readable, scrollable, and still
 * there after you glance at another tab.
 *
 * /api/ask is single-turn, so the list below is a log of questions, not a
 * conversation. Nothing here implies the model remembers the previous one.
 */

interface Turn {
  id: number;
  question: string;
  answer: string;
  done: boolean;
}

/** Questions a keyword search cannot answer, which is the whole reason Ask exists. */
const SUGGESTIONS = [
  "which repo is worst off, and why?",
  "what should I upgrade first?",
  "is it safe to move zod to the next major?",
  "which lurq tools does my team actually use?",
];

/** The route rejects anything longer. */
const MAX_CHARS = 500;

export function AskPanel({ initial }: { initial?: string }) {
  const [draft, setDraft] = useState("");
  const [turns, setTurns] = useState<Turn[]>([]);
  const [asking, setAsking] = useState(false);
  const abort = useRef<AbortController | null>(null);
  const nextId = useRef(0);

  const ask = useCallback(async (raw: string) => {
    const question = raw.trim();
    if (!question) return;
    const controller = new AbortController();
    abort.current = controller;
    const id = nextId.current++;
    const patch = (fn: (t: Turn) => Turn) =>
      setTurns((ts) => ts.map((t) => (t.id === id ? fn(t) : t)));
    const append = (text: string) => patch((t) => ({ ...t, answer: t.answer + text }));

    // Newest first, directly under the box it was typed into.
    setTurns((ts) => [{ id, question, answer: "", done: false }, ...ts]);
    setDraft("");
    setAsking(true);
    try {
      const res = await fetch("/api/ask", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ question }),
        signal: controller.signal,
      });
      if (!res.ok || !res.body) {
        append(
          res.status === 503
            ? "Ask is not configured on this deployment."
            : await res.text().catch(() => "Something went wrong."),
        );
        return;
      }
      // Streamed so a multi-tool question shows its first sentence rather than
      // holding a blank panel for the whole tool loop.
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        append(decoder.decode(value, { stream: true }));
      }
    } catch (err) {
      if ((err as Error).name !== "AbortError") append("Could not reach lurq.");
    } finally {
      patch((t) => ({ ...t, done: true }));
      setAsking(false);
    }
  }, []);

  // Leaving the page stops reading, so the server's tool loop is not left
  // running for an answer nobody will see.
  useEffect(() => () => abort.current?.abort(), []);

  // A question handed over from the palette. Deferred a tick so StrictMode's
  // mount-unmount-mount asks once, not twice; and `?q=` is dropped from the URL
  // so a refresh does not quietly spend another question.
  useEffect(() => {
    if (!initial) return;
    const t = setTimeout(() => {
      window.history.replaceState(null, "", "/dashboard/ask");
      void ask(initial);
    }, 0);
    return () => clearTimeout(t);
  }, [initial, ask]);

  const submit = () => {
    if (!asking) void ask(draft);
  };

  return (
    <div className="max-w-3xl space-y-6">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <Panel padding="none" className="transition-colors focus-within:border-signal/45">
          <textarea
            autoFocus
            rows={3}
            value={draft}
            maxLength={MAX_CHARS}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              // Enter asks, shift+Enter is a new line. Not mid-IME: that Enter
              // is choosing a character, not sending.
              if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                submit();
              }
            }}
            placeholder="ask about your repos, an upgrade, or a package…"
            aria-label="Ask lurq a question"
            className="block w-full resize-none bg-transparent px-4 pt-3.5 text-sm leading-relaxed outline-none placeholder:text-ink-3"
          />
          <div className="flex items-center justify-between gap-3 px-4 pb-3">
            <span className="text-[12px] text-ink-3">⏎ ask · shift ⏎ new line</span>
            <button
              type="submit"
              disabled={asking || !draft.trim()}
              className={buttonVariants({ size: "sm" })}
            >
              {asking ? "reading…" : "ask"}
            </button>
          </div>
        </Panel>
      </form>

      {turns.length === 0 ? (
        <div className="flex flex-wrap gap-2">
          {SUGGESTIONS.map((s) => (
            <button
              key={s}
              type="button"
              disabled={asking}
              onClick={() => void ask(s)}
              className="rounded-[var(--radius-control)] border border-edge px-3 py-1.5 text-[13px] text-ink-2 transition-colors hover:border-signal/45 hover:text-ink"
            >
              {s}
            </button>
          ))}
        </div>
      ) : (
        <ol className="space-y-3">
          {turns.map((t) => (
            <li key={t.id}>
              <Panel>
                <p className="text-[13px] font-medium text-ink">{t.question}</p>
                <p
                  aria-busy={!t.done}
                  className={cn(
                    "mt-3 whitespace-pre-wrap text-sm leading-relaxed",
                    t.answer ? "text-ink-2" : "text-ink-3",
                  )}
                >
                  {t.answer || (t.done ? "No answer came back." : "Reading your account…")}
                  {!t.done && (
                    <span
                      aria-hidden
                      className="ml-0.5 inline-block h-3.5 w-1.5 translate-y-px animate-pulse bg-signal/70"
                    />
                  )}
                </p>
              </Panel>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
