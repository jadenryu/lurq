import { RepoPolicyPanel } from "@/components/dashboard/repo-policy";
import type { RepoPolicy } from "@/lib/lurq-issuer";

/**
 * Autopilot settings for repositories that do not exist yet.
 *
 * Two panels, one job each: this one decides what a repository gets when it is
 * connected, and the table above changes repositories that already exist. That
 * split is what removes the question a combined control would raise — whether
 * saving here rewrites repositories the user has already tuned.
 *
 * It is not a second copy of the per-repo panel, it IS the per-repo panel
 * pointed at a different endpoint. A scope control that behaves differently
 * depending on where you set it is a support ticket, and two components drift
 * the moment one gains a setting.
 *
 * Closed by default, because it is a once-per-account decision sharing a page
 * with the things that change daily. Open, it is the full panel; closed, it is
 * one line that still answers the only question it is asked most of the time —
 * what new repositories are set to.
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
          ? "Applied to repositories you connect from now on. Repositories already connected keep their own settings."
          : "No default set, so repositories arrive off. Set one here and every repository you connect from now on starts this way."
      }
      policy={policy ?? { enabled: false, scope: "blocking", autoMerge: false, checks: { env: true } }}
      demo={demo}
      saveLabel="save default"
      collapsible
    />
  );
}
