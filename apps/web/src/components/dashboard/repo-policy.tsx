"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Chip, Panel, PanelHeader } from "@/components/dashboard/panel";
import { Button } from "@/components/ui/button";
import type { RepoPolicy } from "@/lib/lurq-issuer";
import { cn } from "@/lib/utils";

/**
 * How far an armed repo goes. `comment` is not here: that is `enabled: false`,
 * and offering it twice would let the two controls disagree.
 *
 * `fix` is listed first because it is the one that cannot fail for want of a
 * credential, and it is what a newly armed repo gets.
 */
const MODES: { id: "fix" | "pr"; label: string; blurb: string }[] = [
  {
    id: "fix",
    label: "provable changes only",
    blurb:
      "Opens a pull request containing only what the package itself proves: renamed call sites, and the range bump in every manifest. No model, and no API key to add.",
  },
  {
    id: "pr",
    label: "provable changes, then the agent",
    blurb:
      "Everything above, then an agent migrates what a rule cannot. Needs ANTHROPIC_API_KEY or CLAUDE_CODE_OAUTH_TOKEN in the repository's secrets, or the run fails.",
  },
];

const SCOPES: { id: RepoPolicy["scope"]; label: string; blurb: string }[] = [
  {
    id: "security",
    label: "security only",
    blurb: "Only dependencies with a published advisory.",
  },
  {
    id: "blocking",
    label: "security + breaking",
    blurb:
      "Advisories, plus upgrades whose API surface drops a symbol this repo references, the ones that fail at runtime, not in review.",
  },
  {
    id: "all",
    label: "everything behind",
    blurb: "Every dependency that has a newer release.",
  },
];

function Row({
  label,
  description,
  children,
}: {
  label: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-4 border-t border-border pt-4 first:border-0 first:pt-0">
      <div className="min-w-0 max-w-lg">
        <p className="text-sm font-medium">{label}</p>
        <p className="mt-1 text-sm leading-relaxed text-muted-foreground">{description}</p>
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}

/**
 * The permission grant, made legible.
 *
 * This panel is the one place a user decides how much autonomy lurq has over
 * their repository, so every control states its blast radius in plain language
 * next to itself. Auto-merge in particular is the only setting that lets lurq
 * touch a default branch, and it says so, a toggle whose consequence you have
 * to infer is not consent.
 */
/**
 * `!== false`, the same reading as the server's `permits()` — and it must stay
 * the same reading.
 *
 * A read-only check is on unless someone turns it off, so absent and `true` are
 * the same state and only an explicit `false` is off. Spelling this `=== true`
 * here while the server says `!== false` would render the toggle OFF for every
 * repo connected before checks existed, while the workflow generator treated it
 * as ON — a switch that disagrees with what it controls.
 */
const envOn = (p: RepoPolicy) => p.checks?.env !== false;

/**
 * Mirrors `repoMode()` on the server for an ARMED repo: absent means the agent,
 * because that is what armed meant before the field existed. The server checks
 * `enabled` first, and so does the caller here — this is only reached inside the
 * armed branch.
 */
const modeOf = (p: RepoPolicy): "fix" | "pr" => (p.mode === "fix" ? "fix" : "pr");

export function RepoPolicyPanel({
  repoId,
  policy: initial,
  demo,
}: {
  repoId: number;
  policy: RepoPolicy;
  demo: boolean;
}) {
  const router = useRouter();
  const [policy, setPolicy] = useState<RepoPolicy>(initial);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  const dirty =
    policy.enabled !== initial.enabled ||
    policy.scope !== initial.scope ||
    policy.autoMerge !== initial.autoMerge ||
    policy.mode !== initial.mode ||
    envOn(policy) !== envOn(initial);

  async function save() {
    setSaving(true);
    setError(null);
    const res = await fetch(`/api/repos/${repoId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ policy }),
    });
    setSaving(false);
    if (!res.ok) {
      const body = (await res.json().catch(() => null)) as { error?: string } | null;
      setError(body?.error ?? "Could not save.");
      return;
    }
    startTransition(() => router.refresh());
  }

  return (
    // Anchor target: the repos list links straight here, since the chip there
    // states this setting without being able to change it.
    <Panel id="autopilot" className="scroll-mt-24">
      <PanelHeader
        title="autopilot policy"
        trailing={
          <Chip tone={policy.enabled ? "accent" : "neutral"} dot>
            {policy.enabled ? "armed" : "off"}
          </Chip>
        }
      />

      <div className="mt-5 space-y-4">
        <Row
          label="Let lurq open upgrade pull requests"
          description="Runs in your own GitHub Actions on a schedule. lurq supplies the symbol-level migration brief; the agent edits, runs your test suite, and opens a pull request. Your source never leaves your CI. Each run reads this setting when it starts, so a change here governs the next one — except for a workflow file committed before that was true, which pins its own mode until you re-copy it."
        >
          <Button
            variant={policy.enabled ? "default" : "outline"}
            size="sm"
            disabled={demo}
            // Arming writes `mode` explicitly rather than leaving it absent. An
            // absent mode still resolves to the agent for repos that predate
            // the field, but a repo armed from here should default to the half
            // that cannot fail for want of a credential.
            onClick={() =>
              setPolicy((p) =>
                p.enabled
                  ? { ...p, enabled: false }
                  : { ...p, enabled: true, mode: p.mode ?? "fix" },
              )
            }
          >
            {policy.enabled ? "enabled" : "disabled"}
          </Button>
        </Row>

        {/* Only while armed: off, the question does not apply, and a control
            that reads as live while it governs nothing is the thing this panel
            is written to avoid. */}
        {policy.enabled && (
          <div className="border-t border-border pt-4">
            <p className="text-sm font-medium">How far it goes</p>
            <div className="mt-3 grid gap-2 md:grid-cols-2">
              {MODES.map((option) => {
                const active = modeOf(policy) === option.id;
                return (
                  <button
                    key={option.id}
                    type="button"
                    disabled={demo}
                    aria-pressed={active}
                    onClick={() => setPolicy((p) => ({ ...p, mode: option.id }))}
                    className={cn(
                      "rounded-[var(--radius-control)] border p-3 text-left transition-colors disabled:opacity-60",
                      active
                        ? "border-signal/50 bg-secondary"
                        : "border-border hover:bg-muted/40",
                    )}
                  >
                    <span className="font-mono text-xs lowercase tracking-wide">
                      {option.label}
                    </span>
                    <span className="mt-1.5 block text-xs leading-relaxed text-muted-foreground">
                      {option.blurb}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        <div className="border-t border-border pt-4">
          <p className="text-sm font-medium">Which upgrades it may attempt</p>
          <div className="mt-3 grid gap-2 md:grid-cols-3">
            {SCOPES.map((scope) => {
              const active = policy.scope === scope.id;
              return (
                <button
                  key={scope.id}
                  type="button"
                  disabled={demo}
                  aria-pressed={active}
                  onClick={() => setPolicy((p) => ({ ...p, scope: scope.id }))}
                  className={cn(
                    "rounded-[var(--radius-control)] border p-3 text-left transition-colors disabled:opacity-60",
                    active
                      ? "border-signal/50 bg-secondary"
                      : "border-border hover:bg-muted/40",
                  )}
                >
                  <span className="font-mono text-xs lowercase tracking-wide">{scope.label}</span>
                  <span className="mt-1.5 block text-xs leading-relaxed text-muted-foreground">
                    {scope.blurb}
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        <Row
          label="Merge automatically when your CI passes"
          description="Off by default, and the only setting that lets lurq change your default branch. With it off, every change waits for a human on a pull request."
        >
          <Button
            variant={policy.autoMerge ? "default" : "outline"}
            size="sm"
            disabled={demo || !policy.enabled}
            onClick={() => setPolicy((p) => ({ ...p, autoMerge: !p.autoMerge }))}
          >
            {policy.autoMerge ? "on" : "off"}
          </Button>
        </Row>

        <Row
          label="Check for undeclared environment variables"
          description="Adds a read-only step to the generated workflow: variables your code reads that none of your .env files declare. It needs no API key, never writes anything, and does not fail your build."
        >
          {/* Not disabled on `!policy.enabled`, unlike auto-merge: this check
              writes nothing, so it is useful precisely on a repo that has not
              armed the agent — and gating it there would leave those repos
              unable to turn it on at all. */}
          <Button
            variant={envOn(policy) ? "default" : "outline"}
            size="sm"
            disabled={demo}
            onClick={() =>
              setPolicy((p) => ({ ...p, checks: { ...p.checks, env: !envOn(p) } }))
            }
          >
            {envOn(policy) ? "on" : "off"}
          </Button>
        </Row>
      </div>

      <div className="mt-5 flex items-center justify-end gap-3 border-t border-border pt-4">
        {error && <span className="font-mono text-xs text-bad">{error}</span>}
        {dirty && !demo && (
          <Button variant="ghost" size="sm" onClick={() => setPolicy(initial)}>
            reset
          </Button>
        )}
        <Button size="sm" disabled={demo || !dirty || saving} onClick={() => void save()}>
          {saving ? "saving…" : "save policy"}
        </Button>
      </div>
    </Panel>
  );
}
