"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Chip, Panel, PanelHeader } from "@/components/dashboard/panel";
import { Button } from "@/components/ui/button";
import type { RepoPolicy } from "@/lib/lurq-issuer";
import { cn } from "@/lib/utils";

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
      "Advisories, plus upgrades whose API surface drops a symbol this repo references — the ones that fail at runtime, not in review.",
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
 * touch a default branch, and it says so — a toggle whose consequence you have
 * to infer is not consent.
 */
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
    policy.autoMerge !== initial.autoMerge;

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
    <Panel>
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
          description="Runs in your own GitHub Actions on a schedule. lurq supplies the symbol-level migration brief; the agent edits, runs your test suite, and opens a pull request. Your source never leaves your CI."
        >
          <Button
            variant={policy.enabled ? "default" : "outline"}
            size="sm"
            disabled={demo}
            onClick={() => setPolicy((p) => ({ ...p, enabled: !p.enabled }))}
          >
            {policy.enabled ? "enabled" : "disabled"}
          </Button>
        </Row>

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
