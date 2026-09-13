/**
 * Email bodies: HTML from the React Email templates in `./emails`, plus the
 * subject and plain-text part, which stay here so every word is unit-tested.
 *
 * To change how an email looks, run `npm run email:dev` and edit
 * `./emails/theme.ts` (colours, sizes) or `./emails/*.tsx` (structure); the
 * preview reloads as you save. React escapes everything interpolated, which
 * matters: package names, server aliases and change summaries come from
 * outside lurq.
 */
import { createElement } from 'react';
import { render } from 'react-email';
import { digestCopy, KIND_LABEL, urgentCopy } from './emails/copy';
import type { DigestSummary, Links, UrgentItem } from './emails/types';
import UrgentEmail from './emails/urgent';
import WeeklyEmail from './emails/weekly';

export type { DigestSummary, Links, UrgentItem, UrgentKind } from './emails/types';

export interface Rendered {
  subject: string;
  html: string;
  text: string;
}

const footerText = (why: string, links: Links) =>
  `${why}\nTurn these off: ${links.unsubscribeUrl}\nEmail settings: ${links.settingsUrl}`;

export async function renderUrgent(items: UrgentItem[], links: Links): Promise<Rendered> {
  const copy = urgentCopy(items);
  const text = [
    copy.intro,
    '',
    ...items.flatMap((i) => [`${KIND_LABEL[i.kind]}: ${i.title}`, i.detail, i.url, '']),
    footerText(copy.why, links),
  ].join('\n');
  return { subject: copy.subject, html: await render(createElement(UrgentEmail, { items, links })), text };
}

export async function renderDigest(s: DigestSummary, links: Links): Promise<Rendered> {
  const copy = digestCopy(s);
  const lines = [copy.headline, ''];
  if (s.mcpChanges.length) lines.push('MCP server changes:', ...s.mcpChanges.map((c) => `- [${c.severity}] ${c.alias}: ${c.summary} ${c.url}`), '');
  if (s.alerts.length) lines.push('Breaking releases:', ...s.alerts.map((a) => `- ${a.title} ${a.url}`), '');
  if (s.unreadable.length) lines.push('Could not be read last scan:', ...s.unreadable.map((u) => `- ${u.alias} (${u.status}) ${u.url}`), '');
  if (s.stale.length) lines.push('Not scanned in over a week:', ...s.stale.map((u) => `- ${u.alias}, ${u.days} days ${u.url}`), '');
  lines.push(footerText(copy.why, links));
  return { subject: copy.subject, html: await render(createElement(WeeklyEmail, { summary: s, links })), text: lines.join('\n') };
}
