"use client";

import { useEffect, useRef, useState } from "react";

import { INSTALL_COMMAND } from "@/content/copy";
import type { Call } from "@/content/capabilities";

/**
 * The back of a capability card: the call, and two ways to take it with you.
 *
 * Black terminal, one prompt line, the request body, and nothing else. The
 * temptation here is to also print a response, and content/surfaces.ts has the
 * standing answer for why not: a verdict on a marketing page is a claim about a
 * day that has already passed. The body is a real request against a real
 * schema, and it is checkable. A response would be neither.
 *
 * TWO BUTTONS, because there are two people holding this card. One is going to
 * paste JSON into an editor that already has lurq connected, and wants exactly
 * the body. The other is in a chat window, has never installed anything, and
 * wants a paragraph that will make an assistant do the right thing. Copying the
 * bare JSON serves the first and strands the second: `{"package": "reqeusts"}`
 * pasted into a chat means nothing without the tool name around it.
 */

/** How long a button holds its confirmation before going back to its label. */
const CONFIRM_MS = 1600;

/**
 * The call as something you can paste into any assistant.
 *
 * Names the tool, gives the body, and says what to do when lurq is not
 * connected yet, which is the state the reader is in nearly every time. Without
 * that last line the paste produces "I don't have that tool", which reads as
 * lurq not working rather than as lurq not being installed.
 */
function forModel(call: Call, question: string): string {
  return [
    `Use the lurq MCP tool \`${call.tool}\` to answer: ${question}`,
    "",
    "Call it with:",
    "```json",
    call.body,
    "```",
    "",
    `If you do not have lurq's tools, it is one command to connect: ${INSTALL_COMMAND}`,
  ].join("\n");
}

/**
 * Copy, with the fallback the clipboard API needs.
 *
 * `navigator.clipboard` is undefined on insecure origins and blocked inside some
 * embedded browsers. Same failure and same answer as copy-command-button.tsx:
 * a detached textarea and the deprecated execCommand, because a copy button that
 * silently does nothing is worse than a deprecation.
 */
async function copy(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const area = document.createElement("textarea");
    area.value = text;
    area.setAttribute("readonly", "");
    area.style.position = "fixed";
    area.style.top = "-9999px";
    document.body.appendChild(area);
    try {
      area.select();
      return document.execCommand("copy");
    } catch {
      return false;
    } finally {
      document.body.removeChild(area);
    }
  }
}

function CopyButton({
  text,
  label,
  done,
  primary,
}: {
  text: string;
  label: string;
  done: string;
  primary?: boolean;
}) {
  const [state, setState] = useState<"idle" | "ok" | "failed">("idle");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => void (timer.current && clearTimeout(timer.current)), []);

  return (
    <button
      type="button"
      data-primary={primary || undefined}
      className="room-call-btn"
      onClick={async () => {
        setState((await copy(text)) ? "ok" : "failed");
        if (timer.current) clearTimeout(timer.current);
        timer.current = setTimeout(() => setState("idle"), CONFIRM_MS);
      }}
    >
      {state === "ok" ? done : state === "failed" ? "Copy failed" : label}
    </button>
  );
}

export function CallPanel({
  call,
  question,
  onClose,
}: {
  call: Call;
  question: string;
  onClose: () => void;
}) {
  return (
    <div className="room-call">
      <div className="room-call-bar">
        <span aria-hidden className="room-surface-dots" />
        <span className="ml-auto font-mono text-[11px] text-ink-3">lurq · {call.tool}</span>
        <button
          type="button"
          onClick={onClose}
          aria-label="Back to the question"
          className="room-call-close"
        >
          <svg aria-hidden viewBox="0 0 16 16" width="13" height="13" fill="none">
            <path
              d="M9.5 4 5.5 8l4 4"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </button>
      </div>

      {/* The call. `pre` rather than a highlighter: this is twelve tokens of
          JSON, and a syntax library would be a dependency for colouring three
          key names. */}
      <div className="room-call-body">
        <p className="room-call-prompt">
          <span aria-hidden className="pr-2 text-mark">
            $
          </span>
          {call.tool}
        </p>
        <pre className="room-call-code">{call.body}</pre>
      </div>

      <p className="room-call-note">{call.note}</p>

      <div className="room-call-actions">
        <CopyButton text={call.body} label="Copy call" done="Copied" primary />
        <CopyButton
          text={forModel(call, question)}
          label="Copy for a model"
          done="Copied for a model"
        />
      </div>
    </div>
  );
}
