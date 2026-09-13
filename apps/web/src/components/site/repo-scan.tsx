"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import posthog from "posthog-js";

/**
 * Type a repo or a username, land on your builder report.
 *
 * IT SITS IN THE HERO, under the install command. The command asks for a
 * terminal and a decision; this asks for a name and gives something back, so a
 * visitor who is not installing anything today still has a next move.
 *
 * IT USED TO ANSWER IN PLACE: a drift card under the hero, and a link to the
 * same card on its own page. It showed people their stack and gave them no
 * reason to go any further. It now hands off to /dashboard/report, the one
 * dashboard page open without an account, where the answer is what kind of
 * builder they are, inside the product, with the evidence and every other tab
 * one modal sign-up away.
 *
 * Navigation, not fetch-then-navigate: the report owns loading, failure and
 * retry, with an input they can correct on the spot. Checking here first would
 * scan twice or keep a second copy of every failure message.
 */
export function RepoScan() {
  const router = useRouter();
  const [target, setTarget] = useState("");
  const [leaving, setLeaving] = useState(false);

  function submit(event: React.FormEvent) {
    event.preventDefault();
    const value = target.trim();
    if (!value || leaving) return;
    // The top of the funnel: the only step that knows what was typed. The
    // report's own event carries what came back.
    posthog.capture("scan_run", { target: value });
    setLeaving(true);
    router.push(`/dashboard/report?target=${encodeURIComponent(value)}`);
  }

  return (
    <div className="mx-auto mt-9 w-full max-w-[620px]">
      <form onSubmit={submit} className="room-scan-field">
        <label htmlFor="repo-scan" className="sr-only">
          Your GitHub username or repository
        </label>
        {/* Decoration: the placeholder and the label both already say what goes
            in here. */}
        <span aria-hidden className="room-scan-glyph">
          /
        </span>
        <input
          id="repo-scan"
          value={target}
          // The glyph to the left is already a slash, so a typed or pasted
          // leading slash reads as `//owner/repo`. Fold it into the one that
          // is there rather than showing the user two. Leading whitespace goes
          // with it: a paste from a URL bar or a chat message often carries a
          // space, and `" /owner/repo"` would otherwise keep its slash.
          //
          // Safe on a controlled input: when the stripped value equals the
          // current state React bails out of the re-render, but its controlled
          // -input restore still snaps the DOM value back to state, so the
          // rejected character does not linger in the field.
          onChange={(e) => setTarget(e.target.value.replace(/^[\s/]+/, ""))}
          placeholder="your-name, or your-name/your-repo"
          spellCheck={false}
          autoComplete="off"
          autoCapitalize="off"
          className="room-scan-input"
        />
        <button type="submit" disabled={leaving || !target.trim()} className="room-scan-go">
          {leaving ? "Opening…" : "Scan"}
        </button>
      </form>

      <p className="mt-2.5 text-[12.5px] leading-[1.5] text-ink-3">
        What kind of builder are you? Public GitHub only, no sign-in.
      </p>
    </div>
  );
}
