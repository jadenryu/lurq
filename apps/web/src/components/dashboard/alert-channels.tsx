"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { addChannel, changeChannel, deleteChannel, sendChannelTest } from "@/app/dashboard/notifications/actions";
import { Chip, Panel, PanelHeader } from "@/components/dashboard/panel";
import { Button } from "@/components/ui/button";
import type { AlertChannel, ChannelKind, ChannelSeverity } from "@/lib/lurq-issuer";
import { relativeTime } from "@/lib/format";

const KIND_LABEL: Record<ChannelKind, string> = { slack: "Slack", discord: "Discord", teams: "Teams", webhook: "Webhook" };
const PLACEHOLDER: Record<ChannelKind, string> = {
  slack: "https://hooks.slack.com/services/…",
  discord: "https://discord.com/api/webhooks/…",
  teams: "Webhook URL from a Teams Workflows flow",
  webhook: "https://your-service.example.com/lurq",
};
const SEVERITIES: ChannelSeverity[] = ["critical", "high", "moderate", "low"];

const field =
  "h-9 rounded-[var(--radius-control)] border border-edge bg-surface-2 px-2.5 text-[13px] text-ink outline-none focus-visible:ring-2 focus-visible:ring-signal/50";

function ChannelRow({ channel, demo }: { channel: AlertChannel; demo: boolean }) {
  const [pending, start] = useTransition();
  const [note, setNote] = useState<string | null>(null);
  const act = (fn: () => Promise<{ ok: boolean; error?: string }>, success: string) =>
    start(async () => {
      const r = await fn();
      setNote(r.ok ? success : (r.error ?? "Something went wrong."));
    });

  return (
    <li className="flex flex-wrap items-center gap-x-3 gap-y-2 py-3">
      <Chip tone={channel.enabled ? "good" : "neutral"}>{KIND_LABEL[channel.kind]}</Chip>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm text-ink">{channel.label ?? channel.urlHint}</p>
        <p className="truncate font-mono text-xs text-ink-3">
          {channel.label ? `${channel.urlHint} · ` : ""}
          {channel.lastDeliveredAt ? `last posted ${relativeTime(channel.lastDeliveredAt)}` : "nothing posted yet"}
        </p>
        {channel.disabledReason && <p className="mt-1 text-xs text-ink-2">Switched off: {channel.disabledReason}</p>}
        {!channel.disabledReason && channel.lastError && <p className="mt-1 text-xs text-ink-3">Last error: {channel.lastError}</p>}
        {note && <p className="mt-1 text-xs text-ink-2">{note}</p>}
      </div>
      <select
        aria-label="Minimum severity"
        className={field}
        defaultValue={channel.minSeverity}
        disabled={pending || demo}
        onChange={(e) => act(() => changeChannel(channel.id, { minSeverity: e.target.value as ChannelSeverity }), "Saved.")}
      >
        {SEVERITIES.map((s) => (
          <option key={s} value={s}>
            {s} and up
          </option>
        ))}
      </select>
      <Button variant="outline" size="sm" disabled={pending || demo} onClick={() => act(() => sendChannelTest(channel.id), "Test message sent.")}>
        Test
      </Button>
      <Button
        variant="outline"
        size="sm"
        disabled={pending || demo}
        onClick={() => act(() => changeChannel(channel.id, { enabled: !channel.enabled }), channel.enabled ? "Paused." : "Resumed.")}
      >
        {channel.enabled ? "Pause" : "Resume"}
      </Button>
      <Button
        variant="outline"
        size="sm"
        disabled={pending || demo}
        onClick={() => {
          if (window.confirm("Remove this channel? Its URL is deleted from lurq.")) act(() => deleteChannel(channel.id), "Removed.");
        }}
      >
        Remove
      </Button>
    </li>
  );
}

function AddChannel({ demo }: { demo: boolean }) {
  const [kind, setKind] = useState<ChannelKind>("slack");
  const [url, setUrl] = useState("");
  const [label, setLabel] = useState("");
  const [minSeverity, setMinSeverity] = useState<ChannelSeverity>("high");
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [secret, setSecret] = useState<string | null>(null);

  if (secret) {
    return (
      <div className="mt-3 rounded-[var(--radius-control)] border border-edge bg-surface-2 p-3">
        <p className="text-sm text-ink">Webhook added. This is its signing secret, shown once:</p>
        <code className="mt-2 block break-all font-mono text-xs text-ink">{secret}</code>
        <p className="mt-2 text-xs text-ink-2">
          Verify the <code className="font-mono">X-Lurq-Signature</code> header with it. See the{" "}
          <Link href="/docs/alerts" className="underline underline-offset-4">
            alerts docs
          </Link>
          .
        </p>
        <Button variant="outline" size="sm" className="mt-3" onClick={() => setSecret(null)}>
          Done
        </Button>
      </div>
    );
  }

  return (
    <form
      className="mt-3 flex flex-wrap items-end gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        setError(null);
        start(async () => {
          const r = await addChannel({ kind, url, label: label || undefined, minSeverity });
          if (!r.ok) return setError(r.error);
          setUrl("");
          setLabel("");
          if (r.signingSecret) setSecret(r.signingSecret);
        });
      }}
    >
      <select aria-label="Channel type" className={field} value={kind} onChange={(e) => setKind(e.target.value as ChannelKind)}>
        {(Object.keys(KIND_LABEL) as ChannelKind[]).map((k) => (
          <option key={k} value={k}>
            {KIND_LABEL[k]}
          </option>
        ))}
      </select>
      <input
        aria-label="Webhook URL"
        className={`${field} min-w-[16rem] flex-1`}
        placeholder={PLACEHOLDER[kind]}
        value={url}
        onChange={(e) => setUrl(e.target.value)}
        required
      />
      <input aria-label="Label" className={`${field} w-36`} placeholder="Label (optional)" value={label} onChange={(e) => setLabel(e.target.value)} />
      <select aria-label="Minimum severity" className={field} value={minSeverity} onChange={(e) => setMinSeverity(e.target.value as ChannelSeverity)}>
        {SEVERITIES.map((s) => (
          <option key={s} value={s}>
            {s} and up
          </option>
        ))}
      </select>
      <Button type="submit" size="sm" disabled={pending || demo || !url}>
        {pending ? "Sending a test…" : "Add"}
      </Button>
      {error && <p className="w-full text-xs text-ink-2">{error}</p>}
    </form>
  );
}

/**
 * Slack, Discord, Teams and signed webhooks: the team's feed of everything at or
 * above a chosen severity, where email carries only the urgent few.
 */
export function AlertChannels({
  channels,
  allowed,
  configured,
  demo,
}: {
  channels: AlertChannel[];
  allowed: boolean;
  configured: boolean;
  demo: boolean;
}) {
  return (
    <Panel>
      <PanelHeader title="channels" trailing={<span className="font-mono text-xs text-ink-2">{channels.length}</span>} />
      <p className="mt-3 max-w-2xl text-[13px] leading-relaxed text-ink-2">
        Post changes to your MCP servers and repositories into Slack, Discord, Teams, or your own service. Each channel
        gets everything at or above its severity, batched into one message per check.
      </p>

      {!configured ? (
        <p className="mt-3 text-sm text-ink-2">Channels aren&rsquo;t configured on this deployment yet.</p>
      ) : !allowed ? (
        <p className="mt-3 text-sm text-ink-2">
          Channels come with the Team plan.{" "}
          <Link href="/dashboard/billing" className="underline underline-offset-4">
            See plans
          </Link>
          .
        </p>
      ) : (
        <>
          {channels.length > 0 && (
            <ul className="mt-2 divide-y divide-edge">
              {channels.map((c) => (
                <ChannelRow key={c.id} channel={c} demo={demo} />
              ))}
            </ul>
          )}
          <AddChannel demo={demo} />
        </>
      )}
    </Panel>
  );
}
