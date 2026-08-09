"use client";

import { useState } from "react";
import { Chip, Panel, PanelHeader, eyebrow } from "@/components/dashboard/panel";
import { Button } from "@/components/ui/button";

/**
 * The setup step, shown as the file itself rather than a button that does
 * something opaque.
 *
 * lurq does not commit this. It has read-only access to the repository and
 * keeps it: the user creates the file through GitHub's own new-file page,
 * pre-filled. That means the thing granting write access is a commit they made,
 * reviewed, and can revert, not a permission they clicked past.
 */
export function RepoSetup({
  workflow,
  workflowPath,
  setupUrl,
  armed,
}: {
  workflow: string;
  workflowPath: string;
  setupUrl: string;
  armed: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);

  async function copy() {
    await navigator.clipboard.writeText(workflow);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <Panel>
      <PanelHeader
        title="workflow"
        trailing={
          <Chip tone={armed ? "accent" : "neutral"}>{armed ? "pr mode" : "analyse only"}</Chip>
        }
      />

      <p className="mt-4 max-w-2xl text-sm leading-relaxed text-muted-foreground">
        Add <code className="font-mono text-xs">{workflowPath}</code> to run the autopilot in your
        own GitHub Actions. It starts in <code className="font-mono text-xs">comment</code> mode:
        it plans the upgrades and checks them against your code, writing the brief to the run
        summary without changing a line. Switch it to <code className="font-mono text-xs">pr</code>{" "}
        mode when you want the broken call sites rewritten and a pull request opened.
      </p>

      <div className="mt-4 rounded-[var(--radius-control)] border border-border bg-muted/20 px-4 py-3">
        <p className="text-sm leading-relaxed text-muted-foreground">
          <span className="text-foreground">lurq never writes to your repository.</span> Every
          change is made by the workflow&rsquo;s own <code className="font-mono text-xs">GITHUB_TOKEN</code>
          , scoped by the permissions block in the file below, on a branch, never your default
          branch. Deleting the file turns it off.
        </p>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <a href={setupUrl} target="_blank" rel="noreferrer">
          <Button>Create on GitHub</Button>
        </a>
        <Button variant="outline" onClick={() => void copy()}>
          {copied ? "copied" : "copy file"}
        </Button>
        <Button variant="ghost" onClick={() => setOpen((v) => !v)}>
          {open ? "hide" : "read it first"}
        </Button>
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
          for <code className="font-mono text-xs">pr</code> mode, when you want code rewritten. An
          existing Claude Pro or Max subscription works for the second one. In{" "}
          <code className="font-mono text-xs">comment</code> mode you get the full drift and
          breakage brief without either.
        </p>
      </div>
    </Panel>
  );
}
