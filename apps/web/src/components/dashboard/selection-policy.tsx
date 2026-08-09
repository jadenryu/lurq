"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Chip, Panel, PanelHeader } from "@/components/dashboard/panel";
import { Button } from "@/components/ui/button";
import type { SelectionPolicy } from "@/lib/lurq-issuer";
import { cn } from "@/lib/utils";

/**
 * The rules an agent is held to when it reaches for a new package.
 *
 * Every control here states its blast radius next to itself, the same standard
 * the autopilot panel is held to: a rule whose consequence you have to infer is
 * not a decision you made. The difference is what "off" means. Autopilot off is
 * safe — lurq does nothing. Selection policy off means every recommendation goes
 * through unfiltered, so this panel says "not enforcing" rather than "off", and
 * never renders an empty rule list as a settled state.
 */

const CONFIDENCES: {
  id: NonNullable<SelectionPolicy["minConfidence"]>;
  blurb: string;
}[] = [
  { id: "promising", blurb: "Some signal beyond a first release." },
  { id: "emerging", blurb: "Real adoption, still moving fast." },
  { id: "proven", blurb: "Long track record, stable surface." },
];

/** The licenses teams actually write rules about. Anything else is typed in. */
const COMMON_LICENSES = ["MIT", "Apache-2.0", "BSD-3-Clause", "ISC", "BSD-2-Clause"];

function Row({
  label,
  description,
  children,
}: {
  label: string;
  description: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-4 border-t border-edge pt-5 first:border-0 first:pt-0">
      <div className="min-w-0 max-w-lg">
        <p className="text-sm font-medium text-ink">{label}</p>
        <p className="mt-1 text-sm leading-relaxed text-ink-2">{description}</p>
      </div>
      {children && <div className="shrink-0">{children}</div>}
    </div>
  );
}

/** A small on/off control that reads as a decision rather than a checkbox. */
function Toggle({
  on,
  disabled,
  onClick,
  labels = ["on", "off"],
}: {
  on: boolean;
  disabled?: boolean;
  onClick: () => void;
  labels?: [string, string];
}) {
  return (
    <Button
      variant={on ? "default" : "outline"}
      size="sm"
      disabled={disabled}
      aria-pressed={on}
      onClick={onClick}
    >
      {on ? labels[0] : labels[1]}
    </Button>
  );
}

/** Package chips with an inline add field. */
function NameList({
  items,
  placeholder,
  disabled,
  onAdd,
  onRemove,
  tone = "neutral",
  empty,
}: {
  items: string[];
  placeholder: string;
  disabled: boolean;
  onAdd: (name: string) => void;
  onRemove: (name: string) => void;
  tone?: "neutral" | "bad";
  empty: string;
}) {
  const [draft, setDraft] = useState("");

  function commit() {
    const name = draft.trim();
    if (!name || items.includes(name)) {
      setDraft("");
      return;
    }
    onAdd(name);
    setDraft("");
  }

  return (
    <div className="mt-3">
      <div className="flex flex-wrap items-center gap-1.5">
        {items.length === 0 && <p className="font-mono text-[0.7rem] text-ink-3">{empty}</p>}
        {items.map((name) => (
          <span
            key={name}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-[var(--radius-chip)] border px-2 py-0.5 font-mono text-[0.7rem]",
              tone === "bad" ? "border-bad/40 text-bad" : "border-edge text-ink-2",
            )}
          >
            {name}
            {!disabled && (
              <button
                type="button"
                onClick={() => onRemove(name)}
                aria-label={`Remove ${name}`}
                className="text-ink-3 transition-colors hover:text-ink"
              >
                ×
              </button>
            )}
          </span>
        ))}
      </div>
      {!disabled && (
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              commit();
            }
          }}
          onBlur={commit}
          placeholder={placeholder}
          spellCheck={false}
          className="mt-2.5 w-full max-w-sm rounded-[var(--radius-control)] border border-edge bg-surface-2 px-2.5 py-1.5 font-mono text-xs text-ink placeholder:text-ink-3 focus:border-signal/50 focus:outline-none"
        />
      )}
    </div>
  );
}

export function SelectionPolicyPanel({
  policy: initial,
  demo,
  failed,
}: {
  policy: SelectionPolicy;
  demo: boolean;
  failed: boolean;
}) {
  const router = useRouter();
  const [policy, setPolicy] = useState<SelectionPolicy>(initial);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  const locked = demo || failed;

  const dirty = useMemo(
    () => JSON.stringify(policy) !== JSON.stringify(initial),
    [policy, initial],
  );

  // "Enforcing" is not the same as "configured". A policy with only an allow
  // list rules on nothing, so the chip has to read the rules, not the record.
  const enforcing =
    policy.deny.length > 0 ||
    policy.minConfidence !== null ||
    policy.licenses !== null ||
    policy.blockDeprecated;

  async function save() {
    setSaving(true);
    setError(null);
    const res = await fetch("/api/policy", {
      method: "PUT",
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

  function patch(next: Partial<SelectionPolicy>) {
    setPolicy((p) => ({ ...p, ...next }));
  }

  return (
    <Panel id="selection" className="scroll-mt-24">
      <PanelHeader
        title="selection policy"
        trailing={
          <Chip tone={enforcing ? "accent" : "neutral"} dot>
            {enforcing ? "enforcing" : "not enforcing"}
          </Chip>
        }
      />

      <div className="mt-5 space-y-5">
        <Row
          label="Blocked packages"
          description="Never recommended, and flagged when an agent evaluates one it found on its own. The reason is handed to the agent verbatim — “use the internal http client” redirects it; “denied” just makes it try again."
        />
        <div className="-mt-3">
          <DenyEditor
            deny={policy.deny}
            disabled={locked}
            onChange={(deny) => patch({ deny })}
          />
        </div>

        <Row
          label="Always allowed"
          description="Exceptions that beat every rule below. For the package you have deliberately accepted despite the rules — without this, any rule strict enough to be useful gets switched off the first time it is inconvenient."
        />
        <div className="-mt-3">
          <NameList
            items={policy.allow}
            placeholder="package name, then Enter"
            disabled={locked}
            empty="no exceptions"
            onAdd={(name) => patch({ allow: [...policy.allow, name] })}
            onRemove={(name) => patch({ allow: policy.allow.filter((a) => a !== name) })}
          />
        </div>

        <Row
          label="Refuse deprecated packages"
          description="Blocks anything npm has marked deprecated. Packages lurq has not indexed are never blocked by this — an unknown is not a violation."
        >
          <Toggle
            on={policy.blockDeprecated}
            disabled={locked}
            onClick={() => patch({ blockDeprecated: !policy.blockDeprecated })}
          />
        </Row>

        <div className="border-t border-edge pt-5">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="min-w-0 max-w-lg">
              <p className="text-sm font-medium text-ink">Minimum evidence</p>
              <p className="mt-1 text-sm leading-relaxed text-ink-2">
                How much track record a package needs before lurq will suggest it. Off by
                default — a floor you did not set should not quietly hide half the index
                from your agent.
              </p>
            </div>
            <Toggle
              on={policy.minConfidence !== null}
              disabled={locked}
              labels={["set", "any"]}
              onClick={() =>
                patch({ minConfidence: policy.minConfidence === null ? "emerging" : null })
              }
            />
          </div>
          {policy.minConfidence !== null && (
            <div className="mt-3 grid gap-2 md:grid-cols-3">
              {CONFIDENCES.map((level) => {
                const active = policy.minConfidence === level.id;
                return (
                  <button
                    key={level.id}
                    type="button"
                    disabled={locked}
                    aria-pressed={active}
                    onClick={() => patch({ minConfidence: level.id })}
                    className={cn(
                      "rounded-[var(--radius-control)] border p-3 text-left transition-colors disabled:opacity-60",
                      active
                        ? "border-signal/50 bg-surface-2"
                        : "border-edge hover:bg-surface-2/60",
                    )}
                  >
                    <span className="font-mono text-xs lowercase tracking-wide text-ink">
                      {level.id}
                    </span>
                    <span className="mt-1.5 block text-xs leading-relaxed text-ink-2">
                      {level.blurb}
                    </span>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        <div className="border-t border-edge pt-5">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="min-w-0 max-w-lg">
              <p className="text-sm font-medium text-ink">Allowed licenses</p>
              <p className="mt-1 text-sm leading-relaxed text-ink-2">
                An allowlist, so anything not on it is refused. A package whose license
                lurq has not recorded passes — the rule needs a fact to act on, and “we
                did not look” is not one.
              </p>
            </div>
            <Toggle
              on={policy.licenses !== null}
              disabled={locked}
              labels={["set", "any"]}
              onClick={() =>
                patch({ licenses: policy.licenses === null ? [...COMMON_LICENSES] : null })
              }
            />
          </div>
          {policy.licenses !== null && (
            <>
              <NameList
                items={policy.licenses}
                placeholder="SPDX id, then Enter"
                disabled={locked}
                empty="nothing allowed — every package with a known license is refused"
                onAdd={(name) => patch({ licenses: [...(policy.licenses ?? []), name] })}
                onRemove={(name) =>
                  patch({ licenses: (policy.licenses ?? []).filter((l) => l !== name) })
                }
              />
              {policy.licenses.length === 0 && (
                <p className="mt-2 font-mono text-[0.7rem] text-warn">
                  An empty allowlist refuses everything lurq has a license for.
                </p>
              )}
            </>
          )}
        </div>
      </div>

      <div className="mt-6 flex items-center justify-end gap-3 border-t border-edge pt-4">
        {error && <span className="font-mono text-xs text-bad">{error}</span>}
        {dirty && !locked && (
          <Button variant="ghost" size="sm" onClick={() => setPolicy(initial)}>
            reset
          </Button>
        )}
        <Button size="sm" disabled={locked || !dirty || saving} onClick={() => void save()}>
          {saving ? "saving…" : "save policy"}
        </Button>
      </div>
    </Panel>
  );
}

/** Blocked packages carry a reason, so they get a two-field row rather than a chip. */
function DenyEditor({
  deny,
  disabled,
  onChange,
}: {
  deny: SelectionPolicy["deny"];
  disabled: boolean;
  onChange: (next: SelectionPolicy["deny"]) => void;
}) {
  const [name, setName] = useState("");
  const [reason, setReason] = useState("");

  function add() {
    const trimmed = name.trim();
    if (!trimmed || deny.some((d) => d.name === trimmed)) return;
    const why = reason.trim();
    onChange([...deny, why ? { name: trimmed, reason: why } : { name: trimmed }]);
    setName("");
    setReason("");
  }

  const field =
    "rounded-[var(--radius-control)] border border-edge bg-surface-2 px-2.5 py-1.5 font-mono text-xs text-ink placeholder:text-ink-3 focus:border-signal/50 focus:outline-none";

  return (
    <div className="mt-3">
      {deny.length === 0 ? (
        <p className="font-mono text-[0.7rem] text-ink-3">nothing blocked</p>
      ) : (
        <ul className="divide-y divide-edge border-y border-edge">
          {deny.map((rule) => (
            <li key={rule.name} className="flex items-baseline justify-between gap-4 py-2">
              <div className="min-w-0">
                <span className="font-mono text-xs text-bad">{rule.name}</span>
                <span className="ml-2 text-xs text-ink-2">
                  {rule.reason ?? (
                    <span className="text-ink-3">
                      no reason given — the agent will only be told it is blocked
                    </span>
                  )}
                </span>
              </div>
              {!disabled && (
                <button
                  type="button"
                  onClick={() => onChange(deny.filter((d) => d.name !== rule.name))}
                  aria-label={`Unblock ${rule.name}`}
                  className="shrink-0 font-mono text-[0.7rem] text-ink-3 transition-colors hover:text-ink"
                >
                  remove
                </button>
              )}
            </li>
          ))}
        </ul>
      )}

      {!disabled && (
        <div className="mt-2.5 flex flex-wrap gap-2">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="package name"
            spellCheck={false}
            className={cn(field, "w-44")}
          />
          <input
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                add();
              }
            }}
            placeholder="reason handed to the agent"
            className={cn(field, "min-w-0 flex-1")}
          />
          <Button variant="outline" size="sm" disabled={!name.trim()} onClick={add}>
            block
          </Button>
        </div>
      )}
    </div>
  );
}
