"use client";

import { useState } from "react";
import { useCopy } from "@/lib/use-copy";
import { Chip, Panel, PanelHeader, eyebrow } from "@/components/dashboard/panel";
import { Button } from "@/components/ui/button";
import { MODE_LABEL, MODE_SUMMARY, type RepoMode } from "@/lib/lurq-issuer";

/**
 * The setup step, shown as the file itself rather than a button that does
 * something opaque.
 *
 * lurq does not commit this. It has read-only access to the repository and
 * keeps it: the user creates the file through GitHub's own new-file page,
 * pre-filled. That means the thing granting write access is a commit they made,
 * reviewed, and can revert, not a permission they clicked past.
 */
/** Tone only. The words come from MODE_LABEL, so this chip and the control that sets it agree. */
const MODE_TONE: Record<RepoMode, "accent" | "neutral"> = {
  comment: "neutral",
  fix: "accent",
  pr: "accent",
};

export function RepoSetup({
  workflow,
  workflowPath,
  setupUrl,
  mode,
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
  mode: RepoMode;
}) {
  const [open, setOpen] = useState(false);
  const { copied, copy } = useCopy();

  return (
    <Panel>
      <PanelHeader
        title="or add the workflow by hand"
        trailing={<Chip tone={MODE_TONE[mode]}>{MODE_LABEL[mode]}</Chip>}
      />

      {/* This panel used to re-teach the whole mode set in its own vocabulary,
          beside a control that had just named the same three states differently.
          One panel decides the mode; this one commits the file that runs it, and
          says which mode the file it is handing you will run in. */}
      <p className="mt-4 max-w-2xl text-sm leading-relaxed text-muted-foreground">
        Add <code className="font-mono text-xs">{workflowPath}</code> to run the autopilot in your
        own GitHub Actions. This file runs in{" "}
        <span className="text-foreground">{MODE_LABEL[mode]}</span>: {MODE_SUMMARY[mode]}{" "}
        <a href="#autopilot" className="text-foreground underline underline-offset-2">
          Change that above
        </a>{" "}
        and copy the file again — a workflow already committed pins the mode it was generated
        with.
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
        <Button variant="outline" onClick={() => void copy(workflow)}>
          {copied ? "copied" : "copy file"}
        </Button>
        <Button variant="ghost" onClick={() => setOpen((v) => !v)}>
          {open ? "hide" : "read it first"}
        </Button>
        {/* Sticky: this is pasted into another window and the user comes back,
            so the button still reading "copied" is how they know they took it. */}
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
          <code className="font-mono text-xs text-foreground">CLAUDE_CODE_OAUTH_TOKEN</code>:{" "}
          {mode === "pr"
            ? "required, because this repository is set to let the agent migrate what a rule cannot."
            : "not needed at this setting. Only the agent uses one."}
        </p>
        {/* Only at the setting that needs the credential. These two bullets are
            the longest text on the page and they were being read by every repo,
            including the ones the panel had just told needed no key at all. */}
        {mode === "pr" && (
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
        )}
      </div>
    </Panel>
  );
}
