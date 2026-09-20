/**
 * `lurq-operator notify-preview`: render every account message from sample
 * data, so the templates in `./render.ts` and `./channels.ts` can be seen and
 * iterated on without waiting for a real alert.
 *
 * Writes the two emails (HTML and plain text) and the four channel payloads to a
 * folder, opens the urgent email in a browser, and with `--send-to` sends both
 * emails to a real inbox through Resend — the only honest test of how a mail
 * client renders them.
 */
import { randomUUID } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { getConfig } from '../core/config';
import { openInBrowser } from '../core/open';
import { formatChannel, type ChannelItem } from './channels';
import { sendEmail } from './email';
import { renderDigest, renderUrgent, type DigestSummary, type UrgentItem } from './render';

const WEB = 'https://lurq.run';

export const sampleLinks = {
  unsubscribeUrl: `${WEB}/unsubscribe?token=preview&kind=urgent`,
  settingsUrl: `${WEB}/dashboard/notifications`,
};

export function sampleUrgent(): UrgentItem[] {
  return [
    {
      key: 'mcp:1',
      kind: 'mcp_rug_pull',
      title: 'notes: add_note now instructs your agent',
      detail:
        'A tool description changed after this server was scanned, and the new text tells the model what to do. Review it before your agent uses the server again.',
      url: `${WEB}/dashboard/mcp/1`,
    },
    {
      key: 'mcp:2',
      kind: 'mcp_privilege',
      title: 'fetch: fetch can now do more than you approved',
      detail: 'fetch.readOnlyHint true → false',
      url: `${WEB}/dashboard/mcp/3`,
    },
    {
      key: 'alert:3',
      kind: 'breaking_release',
      title: 'stripe 19.0.0 will install on its own in acme/billing-api',
      detail:
        'The range >=17 already admits 19.0.0, a new major (it resolves 18.5.0 today). The next clean install takes it unless the range is tightened.',
      url: `${WEB}/dashboard/repos/2`,
    },
  ];
}

export function sampleDigest(): DigestSummary {
  return {
    weekOf: '2026-09-07',
    watched: { servers: 4, repos: 3 },
    mcpChanges: [
      {
        severity: 'critical',
        alias: 'notes',
        summary: '1 tool(s) rewrote their description and now instruct the model: add_note',
        url: `${WEB}/dashboard/mcp/1`,
      },
      {
        severity: 'high',
        alias: 'fetch',
        summary: '1 privilege widening(s): fetch.readOnlyHint true→false',
        url: `${WEB}/dashboard/mcp/3`,
      },
      {
        severity: 'low',
        alias: 'linear',
        summary: 'compatible: 2 tool(s) added',
        url: `${WEB}/dashboard/mcp/2`,
      },
    ],
    mcpChangeTotal: 5,
    alerts: [
      {
        title: 'stripe 19.0.0 in acme/billing-api',
        detail: 'The next clean install takes it.',
        url: `${WEB}/dashboard/repos/2`,
      },
    ],
    alertTotal: 1,
    unreadable: [{ alias: 'warehouse', status: 'auth_required', url: `${WEB}/dashboard/mcp/4` }],
    stale: [],
  };
}

export function sampleChannelItems(): ChannelItem[] {
  return sampleUrgent().map((u, i) => ({
    key: u.key,
    severity: (['critical', 'high', 'high'] as const)[i]!,
    source: u.kind === 'breaking_release' ? 'release' : 'mcp',
    title: u.title,
    detail: u.detail,
    url: u.url,
  }));
}

export interface PreviewOptions {
  out?: string;
  sendTo?: string;
  /** `--no-open` sets this false. */
  open?: boolean;
}

export async function runNotifyPreview(opts: PreviewOptions): Promise<void> {
  const dir = resolve(opts.out ?? 'notify-preview');
  mkdirSync(dir, { recursive: true });

  const urgent = renderUrgent(sampleUrgent(), sampleLinks);
  const digest = renderDigest(sampleDigest(), {
    ...sampleLinks,
    unsubscribeUrl: sampleLinks.unsubscribeUrl.replace('urgent', 'digest'),
  });
  const files: [string, string][] = [
    ['urgent.html', urgent.html],
    ['urgent.txt', `Subject: ${urgent.subject}\n\n${urgent.text}`],
    ['digest.html', digest.html],
    ['digest.txt', `Subject: ${digest.subject}\n\n${digest.text}`],
  ];
  const fmt = {
    deliveryId: 'channel:preview',
    dashboardUrl: `${WEB}/dashboard/notifications`,
    now: new Date(),
    signingSecret: 'preview-signing-secret',
  };
  for (const kind of ['slack', 'discord', 'teams', 'webhook'] as const) {
    const m = formatChannel(kind, sampleChannelItems(), 0, fmt);
    files.push([
      `${kind}.json`,
      JSON.stringify({ headers: m.headers, body: JSON.parse(m.payload) }, null, 2),
    ]);
  }
  for (const [name, content] of files) writeFileSync(join(dir, name), content);

  console.log(`wrote ${files.length} files to ${dir}`);
  console.log(`  urgent: ${urgent.subject}`);
  console.log(`  digest: ${digest.subject}`);
  console.log(
    'Edit src/notify/render.ts (email) or src/notify/channels.ts (channels) and run this again.',
  );
  console.log(
    'Paste slack.json\'s "body" into https://app.slack.com/block-kit-builder to see the Slack message.',
  );

  if (opts.open !== false) openInBrowser(join(dir, 'urgent.html'));

  if (opts.sendTo) {
    const c = getConfig();
    if (!c.RESEND_API_KEY) throw new Error('--send-to needs RESEND_API_KEY');
    for (const m of [urgent, digest]) {
      await sendEmail(
        {
          to: opts.sendTo,
          subject: `[preview] ${m.subject}`,
          html: m.html,
          text: m.text,
          idempotencyKey: `preview:${randomUUID()}`,
        },
        { apiKey: c.RESEND_API_KEY, from: c.LURQ_MAIL_FROM },
      );
    }
    console.log(`sent both emails to ${opts.sendTo}`);
  }
}
