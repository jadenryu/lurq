"use client";

import { useId, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, ChevronRight } from "lucide-react";
import { Chip, Panel, PanelHeader } from "@/components/dashboard/panel";
import { Disclosure } from "@/components/dashboard/disclosure";
import { Button } from "@/components/ui/button";
import { MODE_LABEL, repoMode, type RepoPolicy } from "@/lib/lurq-issuer";

/**
 * What autopilot is set to, as one question instead of two.
 *
 * This used to be an on/off toggle plus a mode picker, which asked the reader to
 * hold two facts to know one thing — and named the second one badly: both modes
 * open a pull request, so "pr mode" did not distinguish them. The axis that
 * actually varies is who writes the change, so that is the axis on screen.
 *
 * `off` is the same state the server calls `comment`, and `repoMode()` is the
 * single reading of it. Listing it here rather than keeping a separate boolean
 * is what stops the two controls disagreeing about whether a repo is armed.
 */
const MODES: { id: "comment" | "fix" | "pr"; label: string; note: string; blurb: string }[] = [
  {
    id: "comment",
    label: "off",
    note: "watch only",
    blurb: "lurq keeps reading this repository and reporting drift. It opens nothing.",
  },
  {
    id: "fix",
    label: "provable fixes",
    note: "no API key",
    blurb:
      "Opens a pull request containing only what the package itself proves: renamed call sites, and the range bump in every manifest. No model involved.",
  },
  {
    id: "pr",
    label: "provable fixes, then the agent",
    note: "needs a key",
    blurb:
      "Everything in provable fixes, then an agent migrates what a rule cannot. Needs ANTHROPIC_API_KEY or CLAUDE_CODE_OAUTH_TOKEN in the repository's secrets, or the run fails.",
  },
];

const SCOPES: { id: RepoPolicy["scope"]; label: string; blurb: string }[] = [
  {
    id: "security",
    label: "security",
    blurb: "Only dependencies with a published advisory.",
  },
  {
    id: "blocking",
    label: "security + breaking",
    blurb:
      "Advisories, plus upgrades whose API surface drops a symbol this repo references — the ones that fail at runtime, not in review.",
  },
  {
    id: "all",
    label: "everything behind",
    blurb: "Every dependency that has a newer release.",
  },
];

/**
 * A setting: what it is and what it is set to, on one line.
 *
 * The rationale sits behind the caret rather than under the label. Every control
 * in this panel had a paragraph beside it explaining its blast radius, which is
 * the right information and the wrong altitude — five of them stacked is a page
 * nobody reads, so the consequence nobody reads is the one that matters.
 *
 * The control stays outside the disclosure, so clicking it changes the setting
 * instead of toggling the text.
 */
function Setting({
  label,
  description,
  children,
}: {
  label: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-t border-edge py-3 first:border-0">
      <Disclosure label={label} className="flex-1">
        {description}
      </Disclosure>
      {/* `max-w-full` matters: `shrink-0` alone sizes this to the control's
          max-content, so the scope chips ran off the panel at phone width
          instead of wrapping onto a second line. */}
      <div className="max-w-full shrink-0">{children}</div>
    </div>
  );
}

/** `!== false`, the same reading as the server's `permits()`: absent means on. */
const envOn = (p: RepoPolicy) => p.checks?.env !== false;

/** Off is `enabled: false`; arming writes `mode` explicitly so it cannot resolve to the agent by omission. */
const withMode = (p: RepoPolicy, id: "comment" | "fix" | "pr"): RepoPolicy =>
  id === "comment" ? { ...p, enabled: false } : { ...p, enabled: true, mode: id };

const same = (a: RepoPolicy, b: RepoPolicy) =>
  a.enabled === b.enabled &&
  a.scope === b.scope &&
  a.autoMerge === b.autoMerge &&
  repoMode(a) === repoMode(b) &&
  envOn(a) === envOn(b);

export function RepoPolicyPanel({
  endpoint,
  method = "PATCH",
  title = "autopilot",
  intro,
  extra,
  body,
  saveLabel,
  alwaysSavable = false,
  collapsible = false,
  onSaved,
  policy: initial,
  demo,
}: {
  /** Where a save goes. The same controls govern one repo and the account default. */
  endpoint: string;
  method?: "PATCH" | "PUT";
  title?: string;
  /** A line under the header, for scope the controls cannot state themselves. */
  intro?: string;
  /** Rendered in the footer, left of save — the account panel's "apply to all". */
  extra?: React.ReactNode;
  /** Extra fields merged into the request body alongside `policy`. */
  body?: Record<string, unknown>;
  /** Label on the save button, when "save" understates what it does. */
  saveLabel?: string;
  /**
   * Allow a save that changed nothing on screen.
   *
   * The dirty check is right for one repo — re-saving its own policy is a
   * no-op. It is wrong for a selection: applying an unedited policy to twelve
   * repositories still changes eleven of them.
   */
  alwaysSavable?: boolean;
  /**
   * Start closed, with the header as the disclosure trigger.
   *
   * For the account default: a once-per-account decision that shares a page
   * with the things that change daily. Closed it is still a complete answer to
   * the question it is asked most often — what new repositories are set to —
   * because the header carries the saved state either way.
   */
  collapsible?: boolean;
  /** Called after a save succeeds, for a caller that owns surrounding state. */
  onSaved?: () => void;
  policy: RepoPolicy;
  demo: boolean;
}) {
  const router = useRouter();
  /** Radio `name` must be unique per panel: the repos page renders one and a
      dialog can render another, and a shared name makes them one group. */
  const group = useId();
  const [policy, setPolicy] = useState<RepoPolicy>(initial);
  /**
   * What the server last confirmed, which is not the same thing as what the
   * controls show.
   *
   * The header chip reads from this, so "armed" means saved-and-armed. Reading
   * it off the live controls is what made turning autopilot on unverifiable:
   * the badge flipped on click, said the same thing before and after saving,
   * and left nothing on screen that distinguished intent from state.
   */
  const [saved, setSaved] = useState<RepoPolicy>(initial);
  const [justSaved, setJustSaved] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  const dirty = !same(policy, saved);
  const mode = repoMode(policy);
  const savedMode = repoMode(saved);

  async function save() {
    setSaving(true);
    setError(null);
    const res = await fetch(endpoint, {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ policy, ...body }),
    });
    setSaving(false);
    if (!res.ok) {
      const payload = (await res.json().catch(() => null)) as { error?: string } | null;
      setError(payload?.error ?? "Could not save.");
      return;
    }
    setSaved(policy);
    setJustSaved(true);
    onSaved?.();
    startTransition(() => router.refresh());
  }

  /** Any edit clears the receipt: a tick left over from the last save would be claiming this one is stored too. */
  const edit = (next: (p: RepoPolicy) => RepoPolicy) => {
    setJustSaved(false);
    setPolicy(next);
  };

  const header = (
    <PanelHeader
      title={title}
      info={
        <div className="space-y-2">
          {intro && <p>{intro}</p>}
          {MODES.map((option) => (
            <p key={option.id}>
              <span className="text-ink">{option.label}</span> — {option.blurb}
            </p>
          ))}
        </div>
      }
      trailing={
        <span className="flex items-center gap-2">
          {/* Saved state, not the state of the controls — see `saved` above. */}
          <Chip tone={saved.enabled ? "accent" : "neutral"} dot>
            {MODE_LABEL[savedMode]}
          </Chip>
          {collapsible && (
            <ChevronRight
              aria-hidden
              className="size-4 shrink-0 text-ink-3 transition-transform group-open:rotate-90 motion-reduce:transition-none"
            />
          )}
        </span>
      }
    />
  );

  const content = (
    <div className="space-y-4">
      <div>
        {/* Real radios, visually hidden and driven through `peer-*`. A group of
            buttons wearing `role="radio"` looks identical and is not the same
            control: arrow-key navigation, the single tab stop and the group
            announcement all come from the platform, and hand-rolling them is
            how a settings page ends up keyboard-hostile. */}
        <fieldset className="grid gap-1.5" disabled={demo}>
          <legend className="sr-only">How far autopilot goes</legend>
          {MODES.map((option) => (
            <label
              key={option.id}
              className="flex cursor-pointer items-center gap-2.5 rounded-[var(--radius-control)] border border-edge px-3 py-2 transition-colors has-[:checked]:border-edge-lit has-[:checked]:bg-surface-2 has-[:disabled]:cursor-default has-[:disabled]:opacity-60 hover:bg-muted/40 has-[:checked]:hover:bg-surface-2 has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-signal"
            >
              <input
                type="radio"
                name={group}
                value={option.id}
                checked={mode === option.id}
                onChange={() => edit((p) => withMode(p, option.id))}
                className="peer sr-only"
              />
              {/* `peer-checked:` selects siblings of the input, so the inner dot
                  — a descendant of a sibling — has to be reached through it. */}
              <span
                aria-hidden
                className="grid size-3.5 shrink-0 place-items-center rounded-full border border-edge-lit peer-checked:border-signal peer-checked:[&>span]:opacity-100"
              >
                <span className="size-[7px] rounded-full bg-signal opacity-0" />
              </span>
              <span className="min-w-0 flex-1 text-[13px] text-ink">{option.label}</span>
              <span className="shrink-0 text-[11.5px] text-ink-3">{option.note}</span>
            </label>
          ))}
        </fieldset>
      </div>

      <div>
        {/* Off, this question does not apply: a live-looking control that
            governs nothing is the thing this panel is written to avoid. */}
        <Setting
          label="Which upgrades it may attempt"
          description={SCOPES.find((s) => s.id === policy.scope)?.blurb ?? ""}
        >
          <fieldset className="flex flex-wrap gap-1" disabled={demo || mode === "comment"}>
            <legend className="sr-only">Which upgrades autopilot may attempt</legend>
            {SCOPES.map((scope) => (
              <label
                key={scope.id}
                className="cursor-pointer rounded-[var(--radius-control)] border border-edge px-2.5 py-1.5 font-mono text-[11.5px] lowercase text-ink-2 transition-colors has-[:checked]:border-edge-lit has-[:checked]:bg-surface-2 has-[:checked]:text-ink has-[:disabled]:cursor-default has-[:disabled]:opacity-60 hover:bg-muted/40 has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-signal"
              >
                <input
                  type="radio"
                  name={`${group}-scope`}
                  value={scope.id}
                  checked={policy.scope === scope.id}
                  onChange={() => edit((p) => ({ ...p, scope: scope.id }))}
                  className="sr-only"
                />
                {scope.label}
              </label>
            ))}
          </fieldset>
        </Setting>

        <Setting
          label="Merge automatically when your CI passes"
          description="Off by default, and the only setting that lets lurq change your default branch. With it off, every change waits for a human on a pull request."
        >
          <Button
            variant={policy.autoMerge ? "default" : "outline"}
            size="sm"
            disabled={demo || mode === "comment"}
            onClick={() => edit((p) => ({ ...p, autoMerge: !p.autoMerge }))}
          >
            {policy.autoMerge ? "on" : "off"}
          </Button>
        </Setting>

        <Setting
          label="Check for undeclared environment variables"
          description="Adds a read-only step to the generated workflow: variables your code reads that none of your .env files declare. It needs no API key, never writes anything, and does not fail your build."
        >
          {/* Not gated on the mode, unlike auto-merge: this check writes
              nothing, so it is useful precisely on a repo that has not armed
              the agent — and gating it there would leave those repos unable to
              turn it on at all. */}
          <Button
            variant={envOn(policy) ? "default" : "outline"}
            size="sm"
            disabled={demo}
            onClick={() => edit((p) => ({ ...p, checks: { ...p.checks, env: !envOn(p) } }))}
          >
            {envOn(policy) ? "on" : "off"}
          </Button>
        </Setting>
      </div>

      <div className="flex flex-wrap items-center justify-end gap-3 border-t border-edge pt-4">
        {extra && <div className="mr-auto">{extra}</div>}
        {/* A panel of dead controls with no reason given reads as a bug, and was
            reported as one. The header already carries a "demo data" chip, but
            it is at the top of the page and says nothing about what is editable. */}
        {demo && (
          <span className="mr-auto text-[12.5px] text-ink-3">
            Demo account — these settings are read-only.
          </span>
        )}
        {error && <span className="font-mono text-xs text-bad">{error}</span>}
        {/* The receipt. A save that refreshes the page and says nothing is
            indistinguishable from a click that missed. */}
        {justSaved && !dirty && !error && (
          <span className="flex items-center gap-1.5 text-[12.5px] text-ink-2">
            <Check aria-hidden className="size-3.5 text-ok" />
            saved
          </span>
        )}
        {dirty && !demo && (
          <>
            <span className="text-[12.5px] text-ink-3">unsaved</span>
            <Button variant="ghost" size="sm" onClick={() => edit(() => saved)}>
              reset
            </Button>
          </>
        )}
        <Button
          size="sm"
          disabled={demo || saving || (!dirty && !alwaysSavable)}
          onClick={() => void save()}
        >
          {saving ? "saving…" : (saveLabel ?? "save")}
        </Button>
      </div>
    </div>
  );

  // Anchor target: the repos list links straight here, since the chip there
  // states this setting without being able to change it.
  return collapsible ? (
    /* Not `Panel` here: its padding is what would leave a bare strip under the
       header while closed. The details element IS the panel, the header sits
       flush against its own bottom rule, and the padding belongs to content
       that only exists when the panel is open. */
    <details
      id="autopilot"
      style={{ "--panel-px": "1.125rem" } as React.CSSProperties}
      className="group scroll-mt-24 overflow-hidden rounded-[var(--radius-panel)] border border-edge bg-surface"
    >
      <summary className="cursor-pointer list-none [&::-webkit-details-marker]:hidden [&>div]:m-0">
        {header}
      </summary>
      <div className="p-[var(--panel-px)]">{content}</div>
    </details>
  ) : (
    <Panel id="autopilot" className="scroll-mt-24">
      {header}
      {content}
    </Panel>
  );
}
