/**
 * Email bodies. Pure, so every word a user receives is unit-tested.
 *
 * Written to be read in a notification preview: the subject says what happened,
 * the first line says what to do, and every item links to the exact page that
 * shows it. Everything interpolated is escaped — package names, server aliases
 * and change summaries all come from outside lurq.
 */
import type { Severity } from '../audit/types';

export type UrgentKind = 'mcp_rug_pull' | 'mcp_privilege' | 'breaking_release' | 'mcp_public_change';

export interface UrgentItem {
  key: string;
  kind: UrgentKind;
  title: string;
  detail: string;
  url: string;
}

export interface DigestSummary {
  weekOf: string;
  watched: { servers: number; repos: number };
  mcpChanges: { severity: Severity; alias: string; summary: string; url: string }[];
  mcpChangeTotal: number;
  alerts: { title: string; detail: string; url: string }[];
  alertTotal: number;
  unreadable: { alias: string; status: string; url: string }[];
  stale: { alias: string; days: number; url: string }[];
}

export interface Links {
  unsubscribeUrl: string;
  settingsUrl: string;
}

export interface Rendered {
  subject: string;
  html: string;
  text: string;
}

export const esc = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

/** Subject lines are plain text, but must not carry newlines (header injection). */
const oneLine = (s: string, max = 120) => s.replace(/[\r\n]+/g, ' ').slice(0, max);

const KIND_LABEL: Record<UrgentKind, string> = {
  mcp_rug_pull: 'Tool rewritten to instruct your agent',
  mcp_privilege: 'Tool can now do more than you approved',
  breaking_release: 'Breaking release will install on its own',
  mcp_public_change: 'Server changed',
};

function shell(title: string, body: string, footer: string): string {
  return `<div style="background:#0a0a0a;padding:32px 16px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
  <div style="max-width:600px;margin:0 auto;background:#141414;border:1px solid #262626;border-radius:12px;overflow:hidden;">
    <div style="padding:20px 24px;border-bottom:1px solid #1f1f1f;">
      <span style="font-size:15px;font-weight:600;color:#fafafa;">lurq</span>
      <div style="margin-top:8px;font-size:16px;color:#fafafa;">${title}</div>
    </div>
    <div style="padding:8px 24px 20px;">${body}</div>
    <div style="padding:14px 24px;border-top:1px solid #1f1f1f;background:#0f0f0f;font-size:12px;line-height:1.6;color:#6b6b6b;">${footer}</div>
  </div>
</div>`;
}

const row = (label: string, title: string, detail: string, url: string) =>
  `<div style="padding:14px 0;border-bottom:1px solid #1f1f1f;">
  ${label ? `<div style="font-size:11px;letter-spacing:0.06em;text-transform:uppercase;color:#f87171;">${esc(label)}</div>` : ''}
  <div style="margin-top:4px;font-size:14px;font-weight:500;color:#fafafa;">${esc(title)}</div>
  <div style="margin-top:4px;font-size:13px;line-height:1.55;color:#a1a1aa;">${esc(detail)}</div>
  <a href="${esc(url)}" style="display:inline-block;margin-top:8px;font-size:13px;color:#fafafa;">Review it →</a>
</div>`;

const footerHtml = (why: string, links: Links) =>
  `${esc(why)}<br /><a href="${esc(links.unsubscribeUrl)}" style="color:#8a8a8a;">Turn these off</a> · <a href="${esc(links.settingsUrl)}" style="color:#8a8a8a;">Email settings</a>`;

const footerText = (why: string, links: Links) => `${why}\nTurn these off: ${links.unsubscribeUrl}\nEmail settings: ${links.settingsUrl}`;

export function renderUrgent(items: UrgentItem[], links: Links): Rendered {
  const subject =
    items.length === 1 ? `lurq: ${oneLine(items[0]!.title)}` : `lurq: ${items.length} urgent changes to what your agents depend on`;
  const intro =
    items.length === 1 ? 'One change needs a look today.' : `${items.length} changes need a look today.`;
  const why = 'You get this because urgent alerts are on for your lurq account. They only fire for changes like these.';

  const html = shell(
    esc(intro),
    items.map((i) => row(KIND_LABEL[i.kind], i.title, i.detail, i.url)).join(''),
    footerHtml(why, links),
  );
  const text = [
    intro,
    '',
    ...items.flatMap((i) => [`${KIND_LABEL[i.kind]}: ${i.title}`, i.detail, i.url, '']),
    footerText(why, links),
  ].join('\n');
  return { subject, html, text };
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

export function renderDigest(s: DigestSummary, links: Links): Rendered {
  const quiet = s.mcpChangeTotal === 0 && s.alertTotal === 0 && s.unreadable.length === 0 && s.stale.length === 0;
  const headline = quiet
    ? `A quiet week: nothing changed across ${plural(s.watched.servers, 'MCP server')} and ${plural(s.watched.repos, 'repo')}.`
    : `This week: ${plural(s.mcpChangeTotal, 'MCP change')}, ${plural(s.alertTotal, 'breaking release')}.`;
  const subject = oneLine(`lurq weekly: ${quiet ? 'nothing changed' : `${plural(s.mcpChangeTotal, 'MCP change')}, ${plural(s.alertTotal, 'breaking release')}`}`);
  const why = 'You get this because you turned on the weekly summary.';

  const section = (title: string, rows: string) =>
    rows ? `<div style="margin-top:18px;font-size:12px;color:#8a8a8a;">${esc(title)}</div>${rows}` : '';
  const more = (shown: number, total: number) =>
    total > shown ? `<div style="padding-top:8px;font-size:12px;color:#6b6b6b;">and ${total - shown} more in the dashboard</div>` : '';

  const html = shell(
    esc(headline),
    [
      section('MCP server changes', s.mcpChanges.map((c) => row(c.severity === 'critical' || c.severity === 'high' ? c.severity : '', c.alias, c.summary, c.url)).join('') + more(s.mcpChanges.length, s.mcpChangeTotal)),
      section('Breaking releases', s.alerts.map((a) => row('', a.title, a.detail, a.url)).join('') + more(s.alerts.length, s.alertTotal)),
      section('Could not be read last scan', s.unreadable.map((u) => row('', u.alias, u.status.replace(/_/g, ' '), u.url)).join('')),
      section('Not scanned in over a week', s.stale.map((u) => row('', u.alias, `last scanned ${u.days} days ago`, u.url)).join('')),
    ].join(''),
    footerHtml(why, links),
  );

  const lines = [headline, ''];
  if (s.mcpChanges.length) lines.push('MCP server changes:', ...s.mcpChanges.map((c) => `- [${c.severity}] ${c.alias}: ${c.summary} ${c.url}`), '');
  if (s.alerts.length) lines.push('Breaking releases:', ...s.alerts.map((a) => `- ${a.title} ${a.url}`), '');
  if (s.unreadable.length) lines.push('Could not be read last scan:', ...s.unreadable.map((u) => `- ${u.alias} (${u.status}) ${u.url}`), '');
  if (s.stale.length) lines.push('Not scanned in over a week:', ...s.stale.map((u) => `- ${u.alias}, ${u.days} days ${u.url}`), '');
  lines.push(footerText(why, links));
  return { subject, html, text: lines.join('\n') };
}
