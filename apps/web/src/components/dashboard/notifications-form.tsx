"use client";

import { useState, useTransition } from "react";
import { setNotificationPreference } from "@/app/dashboard/preferences/actions";
import { Panel, PanelHeader } from "@/components/dashboard/panel";
import { cn } from "@/lib/utils";

type Key = "urgentEmail" | "weeklyDigest";

const ROWS: { key: Key; title: string; body: string }[] = [
  {
    key: "urgentEmail",
    title: "urgent alerts",
    body: "Only when something needs you today: an MCP server rewrote a tool to instruct your agent, a tool stopped being read-only, or a breaking release will install on its own. Batched, and at most three a day.",
  },
  {
    key: "weeklyDigest",
    title: "weekly summary",
    body: "A Monday email with what changed across your repositories and MCP servers that week. Off unless you turn it on.",
  },
];

/** Saves on click, snapping back if the server refuses, like the range control. */
export function NotificationsForm({
  urgentEmail,
  weeklyDigest,
  emailConfigured,
  demo,
}: {
  urgentEmail: boolean;
  weeklyDigest: boolean;
  emailConfigured: boolean;
  demo: boolean;
}) {
  const [values, setValues] = useState<Record<Key, boolean>>({ urgentEmail, weeklyDigest });
  const [pending, start] = useTransition();

  function toggle(key: Key) {
    const next = !values[key];
    setValues((v) => ({ ...v, [key]: next }));
    start(async () => {
      const { ok } = await setNotificationPreference(key, next);
      if (!ok) setValues((v) => ({ ...v, [key]: !next }));
    });
  }

  return (
    <Panel>
      <PanelHeader title="email" />
      {!emailConfigured && (
        <p className="mt-3 text-sm text-muted-foreground">
          Email isn&rsquo;t configured on this deployment yet, so nothing is sent regardless of these settings.
        </p>
      )}
      <ul className="mt-2 divide-y divide-edge">
        {ROWS.map((row) => (
          <li key={row.key} className="flex items-start justify-between gap-6 py-3">
            <div>
              <p className="text-sm text-ink">{row.title}</p>
              <p className="mt-1 max-w-xl text-[13px] leading-relaxed text-ink-2">{row.body}</p>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={values[row.key]}
              aria-label={row.title}
              disabled={pending || demo}
              onClick={() => toggle(row.key)}
              className={cn(
                "relative mt-0.5 h-5 w-9 shrink-0 rounded-full border transition-colors disabled:opacity-60",
                values[row.key] ? "border-signal/50 bg-signal/40" : "border-edge bg-surface-2",
              )}
            >
              <span
                aria-hidden
                className={cn(
                  "absolute top-1/2 size-3.5 -translate-y-1/2 rounded-full bg-ink transition-[left]",
                  values[row.key] ? "left-[18px]" : "left-[2px]",
                )}
              />
            </button>
          </li>
        ))}
      </ul>
      <p className="mt-2 text-xs text-ink-3">
        Everything else stays in the dashboard. Every email carries a link to turn it off.
      </p>
    </Panel>
  );
}

/** The one-click weekly-summary opt-in, asked where the alerts are. */
export function DigestPrompt({ demo }: { demo: boolean }) {
  const [state, setState] = useState<"idle" | "on" | "failed">("idle");
  const [pending, start] = useTransition();
  if (state === "on") {
    return (
      <Panel padding="tight">
        <p className="text-sm text-ink-2">You&rsquo;ll get a summary on Mondays. Change it in preferences.</p>
      </Panel>
    );
  }
  return (
    <Panel padding="tight">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-ink-2">
          Want a Monday email with what changed this week? Urgent alerts come on their own; this is everything else.
        </p>
        <button
          type="button"
          disabled={pending || demo}
          onClick={() =>
            start(async () => {
              const { ok } = await setNotificationPreference("weeklyDigest", true);
              setState(ok ? "on" : "failed");
            })
          }
          className="h-8 rounded-[var(--radius-control)] border border-edge px-3 text-[13px] text-ink hover:bg-surface-2 disabled:opacity-60"
        >
          {pending ? "Saving…" : state === "failed" ? "Try again" : "Send me a weekly summary"}
        </button>
      </div>
    </Panel>
  );
}
