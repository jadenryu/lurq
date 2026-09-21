import { CopyAgentSetup } from "@/components/dashboard/copy-agent-setup";
import { CopyButton } from "@/components/dashboard/copy-button";
import { Panel, PanelHeader } from "@/components/dashboard/panel";
import { Button } from "@/components/ui/button";
import type { AgentSetupInput } from "@/lib/agent-setup";
import type { DashboardRepo } from "@/lib/lurq-issuer";
import { repoMode } from "@/lib/lurq-issuer";

/**
 * The one step between "armed" and "opening pull requests".
 *
 * Arming a repository changes what lurq is permitted to do; it does not make
 * anything happen. The workflow that acts on it runs in the user's own Actions
 * and lurq deliberately cannot commit it — that commit is the trust boundary.
 * So a repository can sit armed forever, doing nothing, and until now the only
 * hint was a caption in a table cell on another page.
 *
 * Shown only when there is something to do: armed, and the workflow has never
 * reported a run. It disappears the moment one does, which is what keeps it
 * from becoming chrome everyone learns to scroll past.
 *
 * `upkeep === null` is "never reported a run", not "broken" — a repo with
 * nothing behind reports nothing. That is why this says finish setup rather
 * than claiming a failure it cannot see.
 */
export function RepoNextStep({
  repo,
  setup,
  setupUrl,
}: {
  repo: DashboardRepo;
  setup: AgentSetupInput;
  setupUrl: string;
}) {
  if (repoMode(repo.policy) === "comment" || repo.upkeep) return null;

  return (
    <Panel>
      <PanelHeader
        title="finish setup"
        info={
          <>
            lurq has read-only access and never commits to your repository, so the workflow that
            opens pull requests has to be added by you. Handing this to your agent is the short
            path: it mints nothing you have to copy, sets the repository secret from stdin, writes
            the file, and stops before pushing so you read the diff first.
          </>
        }
      />
      <p className="text-[13px] leading-relaxed text-ink-2">
        Autopilot is armed, but no workflow has reported a run. Until{" "}
        <code className="font-mono text-xs text-ink">{setup.workflowPath}</code> is committed to{" "}
        <span className="font-mono text-xs text-ink">{repo.fullName}</span>, nothing will open —
        and once it is, the first scheduled run is up to a week away, so start one yourself.
      </p>
      <div className="mt-4 flex flex-wrap items-center gap-2">
        {/* First, and the only one that carries a key: the agent does every
            step, including the secret, without anything passing through a
            clipboard the user has to reason about. */}
        <CopyAgentSetup setup={setup} />
        {/* The same job as the brief, for someone who would rather type it than
            hand it to an agent. It writes the file and stops; it never commits. */}
        <CopyButton
          label="Copy CLI command"
          copiedLabel="Copied"
          text={`npx lurqrun autopilot init --repo ${repo.fullName} --mode ${repoMode(repo.policy)}`}
        />
        <a href={setupUrl} target="_blank" rel="noreferrer">
          <Button variant="ghost">Create the file on GitHub</Button>
        </a>
      </div>
    </Panel>
  );
}
