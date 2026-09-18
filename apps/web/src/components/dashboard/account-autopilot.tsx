import { RepoPolicyPanel } from "@/components/dashboard/repo-policy";
import type { RepoPolicy } from "@/lib/lurq-issuer";

/**
 * Autopilot settings for repositories that do not exist yet.
 *
 * Two panels, one job each: this one decides what a repository gets when it is
 * connected, and the table below changes repositories that already exist. That
 * split is what removes the question a combined control would raise — whether
 * saving here rewrites repositories the user has already tuned.
 *
 * It is not a second copy of the per-repo panel, it IS the per-repo panel
 * pointed at a different endpoint. A scope control that behaves differently
 * depending on where you set it is a support ticket, and two components drift
 * the moment one gains a setting.
 */
export function AccountAutopilotPanel({
  policy,
  demo,
}: {
  /** Null when the owner has never set one: new repositories arrive off. */
  policy: RepoPolicy | null;
  demo: boolean;
}) {
  return (
    <RepoPolicyPanel
      endpoint="/api/repos/defaults"
      method="PUT"
      title="default for new repositories"
      intro={
        policy
          ? "Applied to repositories you connect from now on. Repositories already connected keep their own settings — select them in the table below to change those."
          : "No default set, so repositories arrive with autopilot off. Set one here and every repository you connect from now on starts this way."
      }
      policy={policy ?? { enabled: false, scope: "blocking", autoMerge: false, checks: { env: true } }}
      demo={demo}
      saveLabel="save default"
    />
  );
}
