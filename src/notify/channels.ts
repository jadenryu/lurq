/**
 * Alert messages for Slack, Discord, Teams and a signed JSON webhook. Pure.
 *
 * Every string that came from outside lurq — a tool summary, a package name, a
 * server alias — is escaped for the platform that renders it. Discord messages
 * additionally disable mentions entirely: a poisoned description that says
 * `@everyone` must not page a whole server.
 *
 * Each platform has a message ceiling (Slack 50 blocks, Discord 10 embeds and
 * 6,000 characters, Teams 28KB), so a formatter takes what fits and says how
 * many more are in the dashboard; the sender leaves the rest unclaimed for the
 * next run.
 */
import { createHmac, timingSafeEqual } from 'node:crypto';
import type { Severity } from '../audit/types';
import type { ChannelKind } from './safeHttp';

export interface ChannelItem {
  key: string;
  severity: Severity;
  source: 'mcp' | 'release';
  title: string;
  detail: string;
  url: string;
}

export interface Formatted {
  /** Serialized once, so a webhook signature covers exactly what is sent. */
  payload: string;
  headers: Record<string, string>;
}

export const ITEM_CAP: Record<ChannelKind, number> = {
  slack: 20,
  discord: 10,
  teams: 10,
  webhook: 50,
};

const SLACK_EMOJI: Record<Severity, string> = {
  critical: ':rotating_light:',
  high: ':warning:',
  moderate: ':large_yellow_circle:',
  low: ':white_circle:',
  info: ':white_circle:',
};
const DISCORD_COLOR: Record<Severity, number> = {
  critical: 0xdc2626,
  high: 0xf97316,
  moderate: 0xeab308,
  low: 0x71717a,
  info: 0x71717a,
};
const SOURCE_LABEL = { mcp: 'MCP server', release: 'breaking release' } as const;

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
const oneLine = (s: string) => s.replace(/\s+/g, ' ').trim();

/** Slack mrkdwn: only &, <, > are special, and `<` is how `<!channel>` would sneak in. */
export const slackEsc = (s: string) =>
  oneLine(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** Discord and Teams markdown: neutralise formatting, links and mentions. */
export const mdEsc = (s: string) =>
  oneLine(s)
    .replace(/[\\`*_~|>[\]()#]/g, (c) => `\\${c}`)
    .replace(/@/g, '@​');

function header(items: ChannelItem[], more: number): string {
  const n = items.length + more;
  return `lurq: ${n} ${n === 1 ? 'change' : 'changes'} to what your agents depend on`;
}

export interface FormatOptions {
  deliveryId: string;
  dashboardUrl: string;
  now: Date;
  signingSecret?: string | null;
}

export function signPayload(secret: string, timestamp: number, payload: string): string {
  return `t=${timestamp},v1=${createHmac('sha256', secret).update(`${timestamp}.${payload}`).digest('hex')}`;
}

/**
 * Verify a lurq webhook signature. Exported so the docs example and a
 * receiver's test can use the exact same check.
 */
export function verifySignature(
  secret: string,
  header: string,
  payload: string,
  nowSeconds: number,
  toleranceSeconds = 300,
): boolean {
  const parts = Object.fromEntries(
    header.split(',').map((p) => p.split('=', 2) as [string, string]),
  );
  const t = Number(parts.t);
  if (!Number.isInteger(t) || !parts.v1 || Math.abs(nowSeconds - t) > toleranceSeconds)
    return false;
  const expected = Buffer.from(signPayload(secret, t, payload).split('v1=')[1]!, 'hex');
  const given = Buffer.from(parts.v1, 'hex');
  return expected.length === given.length && timingSafeEqual(expected, given);
}

function slack(items: ChannelItem[], more: number, o: FormatOptions): Formatted {
  const blocks: unknown[] = [
    { type: 'header', text: { type: 'plain_text', text: clip(header(items, more), 150) } },
  ];
  for (const i of items) {
    blocks.push({
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `${SLACK_EMOJI[i.severity]} *<${i.url}|${clip(slackEsc(i.title), 150)}>*\n${clip(slackEsc(i.detail), 500)}\n_${i.severity} · ${SOURCE_LABEL[i.source]}_`,
      },
    });
  }
  if (more)
    blocks.push({
      type: 'context',
      elements: [{ type: 'mrkdwn', text: `and ${more} more in <${o.dashboardUrl}|the dashboard>` }],
    });
  return { payload: JSON.stringify({ text: header(items, more), blocks }), headers: {} };
}

function discord(items: ChannelItem[], more: number, o: FormatOptions): Formatted {
  // 10 embeds and 6,000 characters across all of them: 200 + 300 per item fits.
  return {
    payload: JSON.stringify({
      username: 'lurq',
      allowed_mentions: { parse: [] },
      content: clip(
        `${header(items, more)}${more ? ` (${more} more in the dashboard: ${o.dashboardUrl})` : ''}`,
        2000,
      ),
      embeds: items.map((i) => ({
        title: clip(mdEsc(i.title), 200),
        url: i.url,
        description: clip(mdEsc(i.detail), 300),
        color: DISCORD_COLOR[i.severity],
        footer: { text: `${i.severity} · ${SOURCE_LABEL[i.source]}` },
      })),
    }),
    headers: {},
  };
}

const TEAMS_MAX_BYTES = 25_000;

function teams(items: ChannelItem[], more: number, o: FormatOptions): Formatted {
  const build = (shown: ChannelItem[], hidden: number) =>
    JSON.stringify({
      type: 'message',
      attachments: [
        {
          contentType: 'application/vnd.microsoft.card.adaptive',
          contentUrl: null,
          content: {
            $schema: 'http://adaptivecards.io/schemas/adaptive-card.json',
            type: 'AdaptiveCard',
            version: '1.4',
            body: [
              {
                type: 'TextBlock',
                text: header(shown, hidden),
                weight: 'Bolder',
                size: 'Medium',
                wrap: true,
              },
              ...shown.flatMap((i) => [
                {
                  type: 'TextBlock',
                  text: `**${i.severity}** · [${clip(mdEsc(i.title), 150)}](${i.url})`,
                  wrap: true,
                  spacing: 'Medium',
                },
                {
                  type: 'TextBlock',
                  text: clip(mdEsc(i.detail), 400),
                  wrap: true,
                  isSubtle: true,
                  spacing: 'None',
                },
              ]),
              ...(hidden
                ? [
                    {
                      type: 'TextBlock',
                      text: `and ${hidden} more in [the dashboard](${o.dashboardUrl})`,
                      wrap: true,
                      isSubtle: true,
                    },
                  ]
                : []),
            ],
          },
        },
      ],
    });
  // The 28KB ceiling is on the whole message; drop items from the end until it fits.
  let shown = items;
  let payload = build(shown, more);
  while (Buffer.byteLength(payload) > TEAMS_MAX_BYTES && shown.length > 1) {
    shown = shown.slice(0, -1);
    payload = build(shown, more + (items.length - shown.length));
  }
  return { payload, headers: {} };
}

function webhook(items: ChannelItem[], more: number, o: FormatOptions): Formatted {
  const payload = JSON.stringify({
    type: 'lurq.alerts',
    delivery: o.deliveryId,
    sentAt: o.now.toISOString(),
    dashboardUrl: o.dashboardUrl,
    more,
    items: items.map(({ key, severity, source, title, detail, url }) => ({
      key,
      severity,
      source,
      title,
      detail,
      url,
    })),
  });
  const headers: Record<string, string> = { 'X-Lurq-Delivery': o.deliveryId };
  if (o.signingSecret)
    headers['X-Lurq-Signature'] = signPayload(
      o.signingSecret,
      Math.floor(o.now.getTime() / 1000),
      payload,
    );
  return { payload, headers };
}

const FORMATTERS = { slack, discord, teams, webhook } as const;

/** Format up to the platform's cap; `more` is how many were left for later. */
export function formatChannel(
  kind: ChannelKind,
  items: ChannelItem[],
  more: number,
  o: FormatOptions,
): Formatted {
  return FORMATTERS[kind](
    items.slice(0, ITEM_CAP[kind]),
    more + Math.max(0, items.length - ITEM_CAP[kind]),
    o,
  );
}

/** The message sent when a channel is added or tested. */
export function formatTest(kind: ChannelKind, minSeverity: Severity, o: FormatOptions): Formatted {
  const item: ChannelItem = {
    key: 'test',
    severity: 'info',
    source: 'mcp',
    title: 'lurq can post here',
    detail: `Changes at ${minSeverity} severity or above, to your MCP servers and connected repositories, will appear in this channel.`,
    url: o.dashboardUrl,
  };
  return formatChannel(kind, [item], 0, o);
}
