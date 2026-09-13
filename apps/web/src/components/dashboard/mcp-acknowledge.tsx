"use client";

import { useState, useTransition } from "react";
import { acknowledgeChange } from "@/app/dashboard/mcp/actions";
import { Button } from "@/components/ui/button";

/** Marks a change as seen. A flap back to it re-opens it on the API side. */
export function AcknowledgeButton({ eventId, disabled = false }: { eventId: number; disabled?: boolean }) {
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
            const { ok } = await acknowledgeChange(eventId);
            setState(ok ? "done" : "failed");
          })
        }
      >
        {pending ? "Saving…" : "Acknowledge"}
      </Button>
    </span>
  );
}
