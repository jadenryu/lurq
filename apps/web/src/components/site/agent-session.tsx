"use client";

import { useEffect, useRef, useState } from "react";

import {
  SESSION_CAPTION,
  SESSION_CHIPS,
  SESSION_CLIENT,
  SESSION_CLIENT_MARK,
  SESSION_CORRECTION,
  SESSION_DETAIL,
  SESSION_PROPOSAL,
  SESSION_REQUEST,
  SESSION_RUN_COMMAND,
  SESSION_RUN_META,
  SESSION_TOOL,
  SESSION_TOOL_ARGS,
} from "@/content/agent-session";

/**
 * The install that would have shipped broken, and the call that caught it.
 *
 * This section deliberately opens with no heading. Every other section on the
 * page introduces itself with an eyebrow, a headline and a paragraph, and by the
 * third one the reader has been told three times and shown nothing. Here the
 * artifact is the opening: you watch the exchange, and the only prose is the
 * caption underneath saying what you just watched.
 *
 * It plays on scroll rather than on load, because a sequence that finishes
 * before you reach it is just a static panel that flickered at someone else. One
 * IntersectionObserver arms it once and disconnects; there is no scroll handler
 * and nothing recomputes on resize.
 *
 * The steps carry their own timing as --reveal-at, matching the hero's
 * convention, so the schedule reads top to bottom in source order rather than
 * hiding in the stylesheet.
 *
 * Provenance rules live in content/agent-session.ts and are load-bearing: the
 * prose is staged, every version and verdict is read out of a recorded run, and
 * the caption on screen says which is which.
 */
export function AgentSession() {
  const ref = useRef<HTMLDivElement>(null);
  const [playing, setPlaying] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    // Already past it (deep link, restored scroll): play rather than wait for a
    // crossing that has happened.
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setPlaying(true);
          io.disconnect();
        }
      },
      // Enough of the panel to be worth watching, but not so much that it only
      // fires on a short viewport after the exchange is already off screen.
      { threshold: 0.25 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  return (
    <section
      id="verify"
      aria-labelledby="verify-title"
      className="w-full px-4 pb-24 min-[768px]:px-6 min-[900px]:pb-32"
    >
      {/* The artifact is the section's title. This names it for the document
          outline and for anyone navigating by heading, without printing a
          fourth centered headline onto the page. */}
      <h2 id="verify-title" className="sr-only">
        What a check looks like
      </h2>

      <div
        ref={ref}
        data-playing={playing ? "true" : undefined}
        className="room-session mx-auto w-full max-w-[880px]"
      >
        <div
          style={{ boxShadow: "0 24px 48px rgba(0,0,0,.35)" }}
          className="overflow-hidden rounded-xl border border-edge border-t-edge-lit bg-surface"
        >
          {/* Title bar, same vocabulary as the drift panel: what you are looking
              at on the left, where it came from on the right. */}
          <div className="flex items-center gap-2.5 border-b border-edge bg-surface-2 px-4 py-3 min-[720px]:px-5">
            <span
              aria-hidden
              className="room-session-mark"
              style={{ ["--mark-src" as string]: `url(${SESSION_CLIENT_MARK})` }}
            />
            <span className="font-mono text-[12px] text-ink">{SESSION_CLIENT}</span>
            <span className="ml-auto font-mono text-[11px] text-ink-3">mcp · lurq</span>
          </div>

          <div className="px-4 py-6 min-[720px]:px-7 min-[720px]:py-8">
            {/* 1. The request. */}
            <p
              data-step
              style={{ ["--reveal-at" as string]: "120ms" }}
              className="room-session-request text-[15px] leading-[1.6] text-ink"
            >
              {SESSION_REQUEST}
            </p>

            {/* 2. The answer a model gives on its own. Confident, and wrong in a
                   way nothing on the agent's side can detect. */}
            <p
              data-step
              style={{ ["--reveal-at" as string]: "560ms" }}
              className="mt-5 text-[15px] leading-[1.6] text-ink-2"
            >
              {SESSION_PROPOSAL}
            </p>

            {/* 3. The call. */}
            <div
              data-step
              style={{ ["--reveal-at" as string]: "980ms" }}
              className="room-session-call mt-5"
            >
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1 border-b border-edge px-3.5 py-2.5 font-mono text-[12px]">
                <span className="text-ink-3">lurq</span>
                <span aria-hidden className="text-edge-lit">
                  ·
                </span>
                <span className="text-ink">{SESSION_TOOL}</span>
                <span className="text-ink-3">{SESSION_TOOL_ARGS}</span>
              </div>

              <div className="relative px-3.5 py-3">
                {/* Held until the verdicts land. Not a spinner for its own sake:
                    it is the beat that makes the answer read as arriving rather
                    than as having always been there. */}
                <p
                  aria-hidden
                  className="room-session-pending font-mono text-[12px] text-ink-3"
                >
                  checking peer ranges
                </p>

                <ul className="room-session-verdicts flex flex-wrap gap-x-5 gap-y-2.5">
                  {SESSION_CHIPS.map((c, i) => (
                    <li
                      key={c.name}
                      style={{ ["--reveal-at" as string]: `${1680 + i * 90}ms` }}
                      className="flex items-center gap-2 font-mono text-[12px]"
                    >
                      <span
                        aria-hidden
                        className="size-1.5 shrink-0 rounded-full"
                        style={{
                          background:
                            c.status === "conflict" ? "var(--conflict)" : "var(--held)",
                        }}
                      />
                      <span className="text-ink-2">{c.name}</span>
                      <span className="text-ink-3">{c.version}</span>
                    </li>
                  ))}
                </ul>
              </div>
            </div>

            {/* 4. The finding, in the product's own words. Quoted rather than
                   paraphrased: this string is the CLI's. */}
            <p
              data-step
              style={{
                ["--reveal-at" as string]: "2120ms",
                borderColor: "var(--conflict)",
              }}
              className="mt-5 border-l-2 pl-4 font-mono text-[12.5px] leading-[1.65] text-ink-2"
            >
              {SESSION_DETAIL}
            </p>

            {/* 5. What the agent does about it. */}
            <p
              data-step
              style={{ ["--reveal-at" as string]: "2420ms" }}
              className="mt-5 text-[15px] leading-[1.6] text-ink"
            >
              {SESSION_CORRECTION}
            </p>
          </div>
        </div>

        {/* Says what the panel is. Never optional: without it this is a
            transcript of a conversation that did not happen. */}
        <div
          data-step
          style={{ ["--reveal-at" as string]: "2700ms" }}
          className="mx-auto mt-6 max-w-[76ch] text-center"
        >
          <p className="font-mono text-[11px] leading-[1.7] text-ink-3">{SESSION_CAPTION}</p>
          {/* The run named outright, so the sentence above it is checkable
              rather than merely asserted. Its own line: folded into the caption
              it reads as the end of that sentence. */}
          <p className="mt-2 break-words font-mono text-[10.5px] leading-[1.7] text-ink-3/65">
            {SESSION_RUN_COMMAND}
          </p>
          <p className="mt-1 font-mono text-[10.5px] leading-[1.7] text-ink-3/65">
            {SESSION_RUN_META}
          </p>
        </div>
      </div>
    </section>
  );
}
