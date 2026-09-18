"use client";

import { useState } from "react";
import { Check, Copy } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  accountSetupPrompt,
  agentSetupPrompt,
  type AccountSetupInput,
  type AgentSetupInput,
} from "@/lib/agent-setup";
import { useCopy } from "@/lib/use-copy";

/**
 * One button that mints a CI key and copies the whole setup brief.
 *
 * Setting the autopilot up by hand is four context switches: create a key on
 * one page, install an app, create a file on GitHub, add secrets in repository
 * settings. This collapses it to install the app, press this, paste. The agent
 * on the other end has a shell and `gh`, which is the whole point.
 *
 * THE KEY IS NEVER RENDERED. It is minted on click, written into the copied
 * text, and dropped — so it cannot be shoulder-surfed or caught in a
 * screenshot. It IS in the clipboard, which is exactly what the brief tells the
 * reader, because a credential you do not know you are carrying is worse than
 * one you do.
 *
 * `CopyButton` is deliberately not reused: it takes a static payload prop,
 * because its own doc says the text should be assembled on the server where the
 * data is. That is right for a prompt with no secret in it and wrong here,
 * where the payload does not exist until the click.
 *
 * Two briefs, one button: `setup` sets up one repository and hands over the
 * workflow the dashboard rendered for it, `account` sets up every repository
 * and delegates the file to `lurq autopilot-init`. They share this component
 * rather than getting one each because none of the interesting parts differ —
 * minting, the failures worth showing verbatim, and the demo-key warning are
 * the same, and a second copy of them would drift on the first fix.
 *
 * The brief is built here rather than passed in because a server component
 * cannot hand a client one a function: only the data crosses, and the key does
 * not exist on the server at all.
 */
type CopySetupProps = { label?: string } & (
  | {
      /** Everything the per-repo brief needs except the key. */
      setup: Omit<AgentSetupInput, "apiKey">;
      account?: never;
    }
  | {
      /** Everything the account-wide brief needs except the key. */
      account: Omit<AccountSetupInput, "apiKey">;
      setup?: never;
    }
);

export function CopyAgentSetup(props: CopySetupProps) {
  const { label = "copy setup for agent" } = props;
  const { copied, copy } = useCopy(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [demo, setDemo] = useState(false);

  async function mintAndCopy() {
    setBusy(true);
    setError(null);
    try {
      // No `policyWrite`, so the server issues `scopes: []` — a key that can
      // read the index and post runs, and cannot rewrite selection policy.
      const res = await fetch("/api/keys", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          // Named for what it is, so the keys panel says which button issued it
          // and revoking the right one does not need guesswork.
          label: props.account
            ? "autopilot · all repositories"
            : `autopilot · ${props.setup.repoFullName}`,
        }),
      });
      const data = (await res.json()) as { key?: string; error?: string; demo?: boolean };

      // Every failure here is visible. A brief copied without its key fails in
      // CI days later, a long way from the button that caused it — the key cap
      // and the rate limit both return a message worth showing verbatim.
      if (!res.ok || !data.key) {
        setError(data.error ?? "Could not create a key. Try again.");
        return;
      }

      const brief = props.account
        ? accountSetupPrompt({ ...props.account, apiKey: data.key })
        : agentSetupPrompt({ ...props.setup, apiKey: data.key });
      const ok = await copy(brief);
      if (!ok) {
        setError("Could not reach the clipboard. Copy the workflow manually instead.");
        return;
      }
      // Demo accounts get a fabricated key from the fixtures. Copying is still
      // useful for seeing the shape, but it must never look like a working one.
      setDemo(data.demo === true);
    } catch {
      setError("Network error. Try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
      <Button type="button" onClick={() => void mintAndCopy()} disabled={busy} className="gap-1.5">
        {copied ? (
          <Check aria-hidden className="size-3.5 text-ok" />
        ) : (
          <Copy aria-hidden className="size-3.5" />
        )}
        {busy ? "preparing…" : copied ? "copied — paste it to your agent" : label}
      </Button>

      {/* Outside the button: inside, it would be folded into the accessible
          name and announced forever after the first click. */}
      <span role="status" aria-live="polite" className="sr-only">
        {copied ? "Setup brief copied, including a new API key" : ""}
      </span>

      {copied && !demo && (
        <span className="text-[12px] text-ink-3">
          includes a new API key — treat the paste as a credential
        </span>
      )}
      {copied && demo && (
        <span className="text-[12px] text-warn">demo data: that key is not real</span>
      )}
      {error && <span className="font-mono text-[12px] text-bad">{error}</span>}
    </div>
  );
}
