"use client";

import { useState } from "react";
import { RepoPolicyPanel } from "@/components/dashboard/repo-policy";
import type { RepoPolicy } from "@/lib/lurq-issuer";

/**
 * Autopilot settings for the account, on the same controls as one repo.
 *
 * The panel is not a second copy of the per-repo one: it is the per-repo one,
 * pointed at a different endpoint. That is the whole reason to build defaults
 * this way — a scope control that behaves differently depending on where you
 * set it is a support ticket, and two components drift the moment one gains a
 * setting.
 */
export function AccountAutopilotPanel({
  policy,
  repoCount,
  demo,
}: {
  /** Null when the owner has never set one: new repos arrive off. */
  policy: RepoPolicy | null;
  repoCount: number;
  demo: boolean;
}) {
  const [applyToAll, setApplyToAll] = useState(false);

  return (
    <RepoPolicyPanel
      endpoint="/api/repos/defaults"
      method="PUT"
      title="autopilot defaults"
      intro={
        policy
          ? "Applied to repositories you connect from now on. Repositories already connected keep their own settings until you apply these to them."
          : "No default set, so repositories arrive with autopilot off. Set one here and every repository you connect from now on starts this way."
      }
      policy={policy ?? { enabled: false, scope: "blocking", autoMerge: false, checks: { env: true } }}
      demo={demo}
      body={{ applyToAll }}
      extra={
        repoCount > 0 ? (
          <label className="flex items-center gap-2 text-sm text-muted-foreground">
            <input
              type="checkbox"
              checked={applyToAll}
              disabled={demo}
              onChange={(e) => setApplyToAll(e.target.checked)}
              className="size-4 accent-[var(--signal)]"
            />
            {/* Stated as a count, not "all repos": the number is the blast
                radius, and this is the control that overwrites settings the
                user may have tuned per repo. */}
            also apply to {repoCount} connected {repoCount === 1 ? "repository" : "repositories"}
          </label>
        ) : undefined
      }
    />
  );
}
