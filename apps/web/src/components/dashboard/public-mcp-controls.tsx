"use client";

import { useState, useTransition } from "react";
import { acknowledgePublicChange, setPin } from "@/app/dashboard/(upkeep)/mcp/public/actions";
import { Button } from "@/components/ui/button";

/**
 * Pin a public MCP server as it is now, or stop watching it. Re-pinning a
 * changed server is how an account approves the change it reviewed.
 */
export function PinToggle({
  endpointId,
  pinned,
  changed,
  disabled = false,
}: {
  endpointId: number;
  pinned: boolean;
  /** Pinned, and the server has changed since. */
  changed: boolean;
  disabled?: boolean;
}) {
  const [pending, start] = useTransition();
  const [failed, setFailed] = useState(false);
  const run = (next: boolean) =>
    start(async () => {
      const { ok } = await setPin(endpointId, next);
      setFailed(!ok);
    });

  return (
    <span className="inline-flex items-center gap-2">
      {failed && <span className="text-xs text-ink-3">could not save</span>}
      {pinned && changed && (
        <Button size="sm" disabled={disabled || pending} onClick={() => run(true)}>
          {pending ? "Saving…" : "Approve changes"}
        </Button>
      )}
      <Button variant="outline" size="sm" disabled={disabled || pending} onClick={() => run(!pinned)}>
        {pending ? "Saving…" : pinned ? "Unpin" : "Pin"}
      </Button>
    </span>
  );
}

/** Marks a public change as seen by this account. Other accounts keep theirs. */
export function PublicAcknowledgeButton({
  changeId,
  endpointId,
  disabled = false,
}: {
  changeId: number;
  endpointId: number;
  disabled?: boolean;
}) {
  const [pending, start] = useTransition();
  const [state, setState] = useState<"idle" | "done" | "failed">("idle");

  if (state === "done") return <span className="text-xs text-ink-3">acknowledged</span>;
  return (
    <span className="inline-flex items-center gap-2">
      {state === "failed" && <span className="text-xs text-ink-3">could not save</span>}
      <Button
        variant="outline"
        size="sm"
        disabled={disabled || pending}
        onClick={() =>
          start(async () => {
            const { ok } = await acknowledgePublicChange(changeId, endpointId);
            setState(ok ? "done" : "failed");
          })
        }
      >
        {pending ? "Saving…" : "Acknowledge"}
      </Button>
    </span>
  );
}
