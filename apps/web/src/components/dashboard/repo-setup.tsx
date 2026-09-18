"use client";

import { useState } from "react";
import { useCopy } from "@/lib/use-copy";
import { Chip, Panel, PanelHeader, eyebrow } from "@/components/dashboard/panel";
import { Button } from "@/components/ui/button";
import { CopyButton } from "@/components/dashboard/copy-button";

/**
 * The setup step, shown as the file itself rather than a button that does
 * something opaque.
 *
 * lurq does not commit this. It has read-only access to the repository and
 * keeps it: the user creates the file through GitHub's own new-file page,
 * pre-filled. That means the thing granting write access is a commit they made,
 * reviewed, and can revert, not a permission they clicked past.
 */
const MODE_CHIP: Record<"comment" | "fix" | "pr", { label: string; tone: "accent" | "neutral" }> = {
  comment: { label: "analyse only", tone: "neutral" },
  fix: { label: "fix mode", tone: "accent" },
  pr: { label: "pr mode", tone: "accent" },
};

export function RepoSetup({
  workflow,
  workflowPath,
  setupUrl,
  mode,
  agentPrompt,
}: {
  workflow: string;
  workflowPath: string;
  setupUrl: string;
  /**
   * The mode this repo's policy resolves to, not whether it is armed. A boolean
   * labelled every armed repo "pr mode", including the ones set to `fix` — which
   * is the mode that needs no API key, i.e. exactly the distinction this panel
   * exists to explain.
   */
  mode: "comment" | "fix" | "pr";
  /**
   * The setup brief for a coding agent, built on the server by
   * `agentSetupPrompt`. Passed in rather than assembled here for the reason
   * CopyButton states: the payload belongs where the data already is.
   */
  agentPrompt: string;
}) {
  const [open, setOpen] = useState(false);
  const { copied, copy } = useCopy();

  return (
    <Panel>
      <PanelHeader
        title="workflow"
        trailing={<Chip tone={MODE_CHIP[mode].tone}>{MODE_CHIP[mode].label}</Chip>}
      />

      <p className="mt-4 max-w-2xl text-sm leading-relaxed text-muted-foreground">
        Add <code className="font-mono text-xs">{workflowPath}</code> to run the autopilot in your
        own GitHub Actions. Three modes, and the middle one is the one most repos want:{" "}
        <code className="font-mono text-xs">comment</code> plans the upgrades and checks them
        against your code, writing the brief to the run summary without changing a line;{" "}
        <code className="font-mono text-xs">fix</code> opens a pull request containing only what
        the package itself proves — renamed call sites, and the range bump in every manifest —
        which needs no API key; <code className="font-mono text-xs">pr</code> adds an agent that
        migrates what a rule cannot and runs your tests.
      </p>

      <div className="mt-4 rounded-[var(--radius-control)] border border-border bg-muted/20 px-4 py-3">
        <p className="text-sm leading-relaxed text-muted-foreground">
          <span className="text-foreground">lurq never writes to your repository.</span> Every
          change is made by the workflow&rsquo;s own <code className="font-mono text-xs">GITHUB_TOKEN</code>
          , scoped by the permissions block in the file below, on a branch, never your default
          branch. Deleting the file turns it off.
        </p>
      </div>

      <p className="mt-4 max-w-2xl text-sm leading-relaxed text-muted-foreground">
        Or hand it to your agent. <span className="text-foreground">Copy for agent</span> gives it
        the whole job — the file, the secrets, and the order to do them in. It asks you for the API
        key rather than carrying one, and it stops before pushing, because committing this file is
        what grants write access.
      </p>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <a href={setupUrl} target="_blank" rel="noreferrer">
          <Button>Create on GitHub</Button>
        </a>
        <Button variant="outline" onClick={() => void copy(workflow)}>
          {copied ? "copied" : "copy file"}
        </Button>
        <Button variant="ghost" onClick={() => setOpen((v) => !v)}>
          {open ? "hide" : "read it first"}
        </Button>
        {/* Sticky: this is pasted into another window and the user comes back,
            so the button still reading "copied" is how they know they took it. */}
        <CopyButton text={agentPrompt} label="copy for agent" variant="ghost" sticky />
      </div>

      {open && (
        <pre className="mt-4 max-h-96 overflow-auto rounded-[var(--radius-control)] border border-border bg-muted/30 p-4 font-mono text-xs leading-relaxed">
          {workflow}
        </pre>
      )}

      {/* The earlier copy listed both secrets as flat requirements, which
          overstated the cost of starting: analysis needs neither Anthropic
          credential, and the agent accepts a subscription token instead of an
          API key. Onboarding friction invented by a caption is the avoidable kind. */}
      <div className="mt-5 space-y-2 border-t border-border pt-4">
        <p className={eyebrow}>repository secrets</p>
        <p className="text-sm leading-relaxed text-muted-foreground">
          <code className="font-mono text-xs text-foreground">LURQ_API_KEY</code>: required. Lets
          the workflow ask which upgrades are outstanding.
        </p>
        <p className="text-sm leading-relaxed text-muted-foreground">
          <code className="font-mono text-xs text-foreground">ANTHROPIC_API_KEY</code> or{" "}
          <code className="font-mono text-xs text-foreground">CLAUDE_CODE_OAUTH_TOKEN</code>: only
          for <code className="font-mono text-xs">pr</code> mode.{" "}
          <code className="font-mono text-xs">comment</code> and{" "}
          <code className="font-mono text-xs">fix</code> need neither — and{" "}
          <code className="font-mono text-xs">fix</code> still opens pull requests.
        </p>
        <ul className="ml-4 list-disc space-y-1.5 text-sm leading-relaxed text-muted-foreground">
          <li>
            Already on Claude Pro or Max? Run{" "}
            <code className="font-mono text-xs text-foreground">claude setup-token</code> and paste
            what it prints into{" "}
            <code className="font-mono text-xs text-foreground">CLAUDE_CODE_OAUTH_TOKEN</code>. It
            is printed once and stored nowhere, so copy it before closing the terminal.
          </li>
          <li>
            {/* The trap this panel exists to prevent: a scheduled job that works
                for a year and then stops, with nothing anywhere saying why. */}
            <span className="text-foreground">That token expires after one year</span>, with no
            renewal and no warning. A weekly job runs fine until it lapses, then fails. An API key
            from the Anthropic console does not expire, and is what Anthropic recommends for a
            secret shared across repositories, since an OAuth token belongs to whoever created it.
          </li>
        </ul>
      </div>
    </Panel>
  );
}
