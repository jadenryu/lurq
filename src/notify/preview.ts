/**
 * `lurq-operator notify-preview`: render every account message from sample
 * data to files, for a quick look or a test send.
 *
 * For designing the emails, use `npm run email:dev` instead: the React Email
 * preview server reloads as you edit `src/notify/emails/`. This command covers
 * what that server does not — the plain-text parts, the Slack, Discord, Teams
 * and webhook payloads, and `--send-to`, which sends both emails to a real inbox
 * through Resend, the only honest test of how a mail client renders them.
 */
import { randomUUID } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { getConfig } from '../core/config';
import { openInBrowser } from '../core/open';
import { formatChannel, type ChannelItem } from './channels';
import { sendEmail } from './email';
import { sampleDigest, sampleLinks, sampleUrgent } from './emails/samples';
import { renderDigest, renderUrgent } from './render';

export { sampleDigest, sampleLinks, sampleUrgent };

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

  const urgent = await renderUrgent(sampleUrgent(), sampleLinks);
  const digest = await renderDigest(sampleDigest(), {
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
    dashboardUrl: 'https://lurq.run/dashboard/notifications',
    now: new Date(),
    signingSecret: 'preview-signing-secret',
  };
  for (const kind of ['slack', 'discord', 'teams', 'webhook'] as const) {
    const m = formatChannel(kind, sampleChannelItems(), 0, fmt);
    files.push([`${kind}.json`, JSON.stringify({ headers: m.headers, body: JSON.parse(m.payload) }, null, 2)]);
  }
  for (const [name, content] of files) writeFileSync(join(dir, name), content);

  console.log(`wrote ${files.length} files to ${dir}`);
  console.log(`  urgent: ${urgent.subject}`);
  console.log(`  digest: ${digest.subject}`);
  console.log('To design the emails with live reload: npm run email:dev (edit src/notify/emails/).');
  console.log('Paste slack.json\'s "body" into https://app.slack.com/block-kit-builder to see the Slack message.');

  if (opts.open !== false) openInBrowser(join(dir, 'urgent.html'));

  if (opts.sendTo) {
    const c = getConfig();
    if (!c.RESEND_API_KEY) throw new Error('--send-to needs RESEND_API_KEY');
    for (const m of [urgent, digest]) {
      await sendEmail(
        { to: opts.sendTo, subject: `[preview] ${m.subject}`, html: m.html, text: m.text, idempotencyKey: `preview:${randomUUID()}` },
        { apiKey: c.RESEND_API_KEY, from: c.LURQ_MAIL_FROM },
      );
    }
    console.log(`sent both emails to ${opts.sendTo}`);
  }
}
