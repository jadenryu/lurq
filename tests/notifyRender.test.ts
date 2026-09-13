/**
 * Every word of account email, rendered without a network or a database. The
 * HTML comes from the React Email templates in src/notify/emails.
 */
import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { render } from 'react-email';
import { renderDigest, renderUrgent, type DigestSummary, type UrgentItem } from '../src/notify/render';
import UrgentEmail from '../src/notify/emails/urgent';
import WeeklyEmail from '../src/notify/emails/weekly';
import { eventItem } from '../src/notify/sources';
import { isDigestWindow, isoWeek } from '../src/notify/run';

const links = { unsubscribeUrl: 'https://lurq.run/unsubscribe?token=t&kind=urgent', settingsUrl: 'https://lurq.run/dashboard/notifications' };

const item = (over: Partial<UrgentItem> = {}): UrgentItem => ({
  key: 'mcp:1',
  kind: 'mcp_rug_pull',
  title: 'notes: add_note now instructs your agent',
  detail: 'A tool description changed.',
  url: 'https://lurq.run/dashboard/mcp/1',
  ...over,
});

describe('renderUrgent', () => {
  it('leads with the change in the subject when there is one', async () => {
    const r = await renderUrgent([item()], links);
    expect(r.subject).toBe('lurq: notes: add_note now instructs your agent');
    expect(r.text).toContain('One change needs a look today.');
    expect(r.html).toContain('https://lurq.run/dashboard/mcp/1');
    expect(r.html).toMatch(/^<!DOCTYPE html/i);
  });

  it('summarises several in the subject and lists each', async () => {
    const r = await renderUrgent(
      [item(), item({ key: 'alert:2', kind: 'breaking_release', title: 'stripe 19.0.0 will install on its own in acme/api' })],
      links,
    );
    expect(r.subject).toBe('lurq: 2 urgent changes to what your agents depend on');
    expect(r.text).toContain('Breaking release will install on its own: stripe 19.0.0');
    expect(r.html).toContain('Breaking release will install on its own');
  });

  it('escapes everything that came from outside lurq', async () => {
    const r = await renderUrgent([item({ title: '<img src=x onerror=alert(1)>', detail: '"quoted" & <b>bold</b>' })], links);
    expect(r.html).not.toContain('<img src=x');
    expect(r.html).toContain('&lt;img src=x onerror=alert(1)&gt;');
    expect(r.html).not.toContain('<b>bold</b>');
  });

  it('keeps header-breaking characters out of the subject', async () => {
    expect((await renderUrgent([item({ title: 'a\r\nBcc: victim@example.com' })], links)).subject).not.toMatch(/[\r\n]/);
  });

  it('always says why it was sent and how to stop it', async () => {
    const r = await renderUrgent([item()], links);
    expect(r.text).toContain(links.unsubscribeUrl);
    expect(r.html).toContain(links.unsubscribeUrl.replace('&', '&amp;'));
    expect(r.html).toContain(links.settingsUrl);
    expect(r.html).toContain('Turn these off');
  });
});

describe('renderDigest', () => {
  const summary = (over: Partial<DigestSummary> = {}): DigestSummary => ({
    weekOf: '2026-09-07',
    watched: { servers: 4, repos: 2 },
    mcpChanges: [],
    mcpChangeTotal: 0,
    alerts: [],
    alertTotal: 0,
    unreadable: [],
    stale: [],
    ...over,
  });

  it('says a quiet week is quiet, with what was watched', async () => {
    const r = await renderDigest(summary(), links);
    expect(r.subject).toBe('lurq weekly: nothing changed');
    expect(r.text).toContain('nothing changed across 4 MCP servers and 2 repos');
  });

  it('counts and lists the week, pointing past what did not fit', async () => {
    const r = await renderDigest(
      summary({
        mcpChanges: [{ severity: 'high', alias: 'fetch', summary: 'fetch.readOnlyHint true→false', url: 'https://lurq.run/dashboard/mcp/3' }],
        mcpChangeTotal: 9,
        alertTotal: 1,
        alerts: [{ title: 'zod 4.0.0 in acme/web', detail: 'd', url: 'https://lurq.run/dashboard/repos/1' }],
        stale: [{ alias: 'warehouse', days: 12, url: 'https://lurq.run/dashboard/mcp/4' }],
      }),
      links,
    );
    expect(r.subject).toBe('lurq weekly: 9 MCP changes, 1 breaking release');
    expect(r.html).toContain('more in the dashboard');
    expect(r.html).toContain('last scanned 12 days ago');
    expect(r.text).toContain('- warehouse, 12 days');
  });
});

describe('templates', () => {
  // The preview server renders each template with its PreviewProps; a template
  // that throws there throws in production too.
  it('render their own preview data', async () => {
    const urgent = await render(createElement(UrgentEmail, UrgentEmail.PreviewProps));
    const weekly = await render(createElement(WeeklyEmail, WeeklyEmail.PreviewProps));
    expect(urgent).toContain('stripe 19.0.0 will install on its own');
    expect(weekly).toContain('MCP server changes');
  });
});

describe('eventItem', () => {
  const base = { id: 7, deploymentId: 3, ownerId: 'user_1', summary: 's', alias: 'notes' };
  const diff = (over: Record<string, unknown>) => ({ rugPull: [], contract: { annotationFlips: [] }, ...over }) as never;

  it('is urgent for a rug pull and for privilege widening, and nothing else', () => {
    expect(eventItem({ ...base, diff: diff({ rugPull: ['add_note'] }) }, 'https://x')?.kind).toBe('mcp_rug_pull');
    expect(
      eventItem(
        { ...base, diff: diff({ contract: { annotationFlips: [{ tool: 'fetch', hint: 'readOnlyHint', from: true, to: false, widensPrivilege: true }] } }) },
        'https://x',
      )?.kind,
    ).toBe('mcp_privilege');
    expect(
      eventItem(
        { ...base, diff: diff({ contract: { annotationFlips: [{ tool: 'f', hint: 'readOnlyHint', from: false, to: true, widensPrivilege: false }] } }) },
        'https://x',
      ),
    ).toBeNull();
    expect(eventItem({ ...base, diff: diff({}) }, 'https://x')).toBeNull();
  });
});

describe('scheduling', () => {
  it('opens the digest window on Monday afternoon UTC only', () => {
    expect(isDigestWindow(new Date('2026-09-14T13:05:00Z'))).toBe(true);
    expect(isDigestWindow(new Date('2026-09-14T09:00:00Z'))).toBe(false);
    expect(isDigestWindow(new Date('2026-09-15T14:00:00Z'))).toBe(false);
  });

  it('keys a week by ISO week, across a year boundary', () => {
    expect(isoWeek(new Date('2026-09-14T13:00:00Z'))).toBe('2026-W38');
    expect(isoWeek(new Date('2027-01-01T13:00:00Z'))).toBe('2026-W53');
  });
});
