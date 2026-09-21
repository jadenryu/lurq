"use client";

import { useState } from "react";
import { Check, Copy } from "lucide-react";
import { Button } from "@/components/ui/button";
import { CopyButton } from "@/components/dashboard/copy-button";
import { setupCommand, setupPrompt, type SetupMode } from "@/lib/agent-setup";
import { useCopy } from "@/lib/use-copy";

/**
 * The step that makes autopilot actually run, as two ways to do the same job.
 *
 * Arming saves a policy and nothing else: the workflow that acts on it has to
 * be in each repository. The agent prompt is the default path — it mints a
 * key, so the user needs nothing but a paste. The terminal command is the same
 * job for someone who would rather run it themselves.
 *
 * THE KEY IS NEVER RENDERED. It is minted on click, written into the copied
 * text, and dropped, so it cannot be shoulder-surfed or caught in a screenshot.
 */
export function AutopilotSetup({
  repos,
  mode,
}: {
  repos: string[];
  mode: SetupMode;
}) {
  const { copied, copy } = useCopy(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [demo, setDemo] = useState(false);
  const noun = repos.length === 1 ? repos[0]! : `${repos.length} repositories`;

  async function mintAndCopy() {
    setBusy(true);
    setError(null);
    try {
      // No `policyWrite`, so the server issues `scopes: []` — a key that can
      // read the index and post runs, and cannot rewrite selection policy.
      const res = await fetch("/api/keys", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ label: `autopilot · ${noun}` }),
      });
      const data = (await res.json()) as { key?: string; error?: string; demo?: boolean };
      // Shown verbatim: the key cap and the rate limit both explain themselves,
      // and a brief copied without its key fails in CI days later.
      if (!res.ok || !data.key) {
        setError(data.error ?? "Could not create a key. Try again.");
        return;
      }
      if (!(await copy(setupPrompt({
            repos,
            mode,
            keysUrl: `${window.location.origin}/dashboard/keys`,
            apiKey: data.key,
          })))) {
        setError("Could not reach the clipboard. Use the terminal command instead.");
        return;
      }
      setDemo(data.demo === true);
    } catch {
      setError("Network error. Try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3">
      <ol className="list-decimal space-y-1 pl-5 text-[13px] leading-relaxed text-ink-2">
        <li>
          Copy the setup prompt and paste it into Claude Code, Cursor or any agent with a terminal.
        </li>
        <li>
          It adds the secret, commits the workflow and starts the first run on {noun}, using your
          own GitHub login. Protected branches get a pull request for you to merge.
        </li>
      </ol>

      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" onClick={() => void mintAndCopy()} disabled={busy} className="gap-1.5">
          {copied ? (
            <Check aria-hidden className="size-3.5 text-ok" />
          ) : (
            <Copy aria-hidden className="size-3.5" />
          )}
          {busy ? "preparing…" : copied ? "copied — paste it to your agent" : "Copy setup prompt"}
        </Button>
        <CopyButton
          label="or copy terminal command"
          copiedLabel="copied"
          variant="ghost"
          text={setupCommand({ repos, mode })}
        />
      </div>

      <span role="status" aria-live="polite" className="sr-only">
        {copied ? "Setup prompt copied, including a new API key" : ""}
      </span>
      {copied && !demo && (
        <p className="text-[12px] text-ink-3">
          The prompt includes a new API key — treat the paste as a credential.
        </p>
      )}
      {copied && demo && <p className="text-[12px] text-warn">demo data: that key is not real</p>}
      {error && <p className="font-mono text-[12px] text-bad">{error}</p>}
    </div>
  );
}
