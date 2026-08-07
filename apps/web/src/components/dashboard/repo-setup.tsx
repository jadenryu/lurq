"use client";

import { useState } from "react";
import { Chip, Panel, PanelHeader } from "@/components/dashboard/panel";
import { Button } from "@/components/ui/button";

/**
 * The setup step, shown as the file itself rather than a button that does
 * something opaque.
 *
 * lurq does not commit this. It has read-only access to the repository and
 * keeps it: the user creates the file through GitHub's own new-file page,
 * pre-filled. That means the thing granting write access is a commit they made,
 * reviewed, and can revert — not a permission they clicked past.
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
        own GitHub Actions. It plans the upgrades, checks them against your code, and — once you
        switch it to <code className="font-mono text-xs">pr</code> mode — rewrites the broken call
        sites and opens a pull request.
      </p>

      <div className="mt-4 rounded-[var(--radius-control)] border border-border bg-muted/20 px-4 py-3">
        <p className="text-sm leading-relaxed text-muted-foreground">
          <span className="text-foreground">lurq never writes to your repository.</span> Every
          change is made by the workflow&rsquo;s own <code className="font-mono text-xs">GITHUB_TOKEN</code>
          , scoped by the permissions block in the file below, on a branch — never your default
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

      <p className="mt-4 font-mono text-xs text-muted-foreground/70">
        Requires two repository secrets: LURQ_API_KEY and ANTHROPIC_API_KEY.
      </p>
    </Panel>
  );
}
