"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Play } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { DispatchOutcome } from "@/lib/lurq-issuer";

/**
 * What each outcome means to the person who pressed the button.
 *
 * None of these except `failed` is a malfunction, and saying "something went
 * wrong" to someone whose workflow was simply never committed sends them
 * looking for a bug instead of doing the one thing that would fix it. The
 * dispatch already distinguished them; nothing was surfacing the distinction.
 */
const OUTCOME: Record<DispatchOutcome, { text: string; tone: "ok" | "bad" }> = {
  dispatched: {
    text: "Run started. Results appear here and in runs as the workflow reports in.",
    tone: "ok",
  },
  "not-armed": {
    text: "This repository is set to off, so a run would do nothing. Choose a mode above first.",
    tone: "bad",
  },
  "no-workflow": {
    text: "No workflow on the default branch yet — commit the file below and try again.",
    tone: "bad",
  },
  "permission-denied": {
    text: "The lurq GitHub App is not allowed to start runs on this repository yet. Re-authorise it from the repositories page.",
    tone: "bad",
  },
  failed: { text: "GitHub would not start the run. Try again in a moment.", tone: "bad" },
};

/**
 * Start a run now instead of at the next cron.
 *
 * The default schedule is Mondays at 06:00 UTC, so a user who armed a
 * repository and committed the workflow on a Tuesday had six days of nothing
 * to look at — which is indistinguishable from a product that does not work.
 */
export function RunNow({ repoId, demo }: { repoId: number; demo: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<DispatchOutcome | null>(null);
  const [, startTransition] = useTransition();

  async function start() {
    setBusy(true);
    setResult(null);
    try {
      const res = await fetch(`/api/repos/${repoId}/dispatch`, { method: "POST" });
      const body = (await res.json().catch(() => null)) as { outcome?: DispatchOutcome } | null;
      setResult(res.ok ? (body?.outcome ?? "failed") : "failed");
      if (res.ok && body?.outcome === "dispatched") startTransition(() => router.refresh());
    } catch {
      setResult("failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
      <Button size="sm" disabled={demo || busy} onClick={() => void start()}>
        <Play aria-hidden className="size-3.5" />
        {busy ? "starting…" : "Run now"}
      </Button>
      {result && (
        <span
          role="status"
          className={`text-[12.5px] ${OUTCOME[result].tone === "ok" ? "text-ink-2" : "text-bad"}`}
        >
          {OUTCOME[result].text}
        </span>
      )}
    </div>
  );
}
