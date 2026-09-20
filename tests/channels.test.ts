/**
 * Alert channels without a network: encryption, URL checks, the private-address
 * guard, every platform's message shape, signatures, and failure classification.
 */
import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { PLANS } from '../src/core/plans';
import { open, seal, secretKey } from '../src/core/secretBox';
import {
  formatChannel,
  formatTest,
  ITEM_CAP,
  mdEsc,
  slackEsc,
  verifySignature,
  type ChannelItem,
} from '../src/notify/channels';
import { classify } from '../src/notify/channelRun';
import { isPrivateAddress, safeLookup, validateChannelUrl } from '../src/notify/safeHttp';

const key = randomBytes(32);

describe('secretBox', () => {
  it('round-trips, and refuses another owner or a tampered value', () => {
    const sealed = seal('https://hooks.slack.com/services/T/B/x', key, 'user_1');
    expect(sealed).not.toContain('hooks.slack.com');
    expect(open(sealed, key, 'user_1')).toBe('https://hooks.slack.com/services/T/B/x');
    expect(() => open(sealed, key, 'user_2')).toThrow();
    const [v, iv, tag, ct] = sealed.split('.');
    const flipped = `${v}.${iv}.${tag}.${ct!.slice(0, -2)}AA`;
    expect(() => open(flipped, key, 'user_1')).toThrow();
  });

  it('rejects a key that is not 32 bytes', () => {
    expect(secretKey(undefined)).toBeNull();
    expect(() => secretKey(Buffer.from('short').toString('base64'))).toThrow(/32 bytes/);
    expect(secretKey(key.toString('base64'))?.length).toBe(32);
  });
});

describe('isPrivateAddress', () => {
  it.each([
    ['127.0.0.1', true],
    ['10.2.3.4', true],
    ['172.20.0.1', true],
    ['192.168.1.1', true],
    ['169.254.169.254', true],
    ['100.64.0.1', true],
    ['0.0.0.0', true],
    ['::1', true],
    ['fd00::1', true],
    ['fe80::1', true],
    ['::ffff:10.0.0.1', true],
    ['::ffff:a00:1', true],
    ['8.8.8.8', false],
    ['2606:4700::1111', false],
    ['not-an-ip', true],
  ])('%s → %s', (ip, expected) => {
    expect(isPrivateAddress(ip)).toBe(expected);
  });
});

describe('safeLookup', () => {
  const fakeDns = (addresses: { address: string; family: number }[]) =>
    ((_h: string, _o: unknown, cb: (e: null, a: typeof addresses) => void) =>
      cb(null, addresses)) as never;

  it('refuses a hostname with any private answer, at connect time', async () => {
    const err = await new Promise<NodeJS.ErrnoException | null>((resolve) =>
      safeLookup(
        fakeDns([
          { address: '93.184.216.34', family: 4 },
          { address: '10.0.0.5', family: 4 },
        ]),
      )('evil.test', {}, (e) => resolve(e)),
    );
    expect(err?.code).toBe('EPRIVATE');
  });

  it('passes a public answer through in both callback shapes', async () => {
    const single = await new Promise<string>((resolve) =>
      safeLookup(fakeDns([{ address: '93.184.216.34', family: 4 }]))('ok.test', {}, (_e, a) =>
        resolve(a as string),
      ),
    );
    expect(single).toBe('93.184.216.34');
    const all = await new Promise<unknown>((resolve) =>
      safeLookup(fakeDns([{ address: '93.184.216.34', family: 4 }]))(
        'ok.test',
        { all: true },
        (_e, a) => resolve(a),
      ),
    );
    expect(all).toEqual([{ address: '93.184.216.34', family: 4 }]);
  });
});

describe('validateChannelUrl', () => {
  it('accepts each provider’s real URL shape', () => {
    expect(validateChannelUrl('slack', 'https://hooks.slack.com/services/T0/B0/abc').ok).toBe(true);
    expect(validateChannelUrl('discord', 'https://discord.com/api/webhooks/1/abc').ok).toBe(true);
    expect(
      validateChannelUrl(
        'teams',
        'https://prod-01.westus.logic.azure.com:443/workflows/abc/triggers/manual/paths/invoke',
      ).ok,
    ).toBe(true);
    expect(validateChannelUrl('webhook', 'https://example.com/lurq').ok).toBe(true);
  });

  it('refuses the wrong provider, plain http, credentials, and the retired Teams connector', () => {
    expect(validateChannelUrl('slack', 'https://discord.com/api/webhooks/1/abc')).toMatchObject({
      ok: false,
    });
    expect(validateChannelUrl('webhook', 'http://example.com/x')).toMatchObject({ ok: false });
    expect(validateChannelUrl('webhook', 'https://user:pw@example.com/x')).toMatchObject({
      ok: false,
    });
    const teams = validateChannelUrl('teams', 'https://acme.webhook.office.com/webhookb2/x');
    expect(teams.ok === false && teams.error).toMatch(/retired/);
  });

  it('refuses private hosts for a generic webhook before any request', () => {
    for (const url of [
      'https://localhost/x',
      'https://127.0.0.1/x',
      'https://[::1]/x',
      'https://169.254.169.254/latest',
      'https://db.internal/x',
    ]) {
      expect(validateChannelUrl('webhook', url).ok, url).toBe(false);
    }
  });
});

const item = (over: Partial<ChannelItem> = {}): ChannelItem => ({
  key: 'mcp:1',
  severity: 'critical',
  source: 'mcp',
  title: 'notes: add_note now instructs your agent',
  detail: 'A tool description changed.',
  url: 'https://lurq.run/dashboard/mcp/1',
  ...over,
});
const opts = {
  deliveryId: 'channel:1:abc',
  dashboardUrl: 'https://lurq.run/dashboard/notifications',
  now: new Date('2026-09-14T14:00:00Z'),
};

describe('formatChannel', () => {
  it('builds Slack Block Kit with escaped text and a link', () => {
    const body = JSON.parse(
      formatChannel('slack', [item({ title: '<!channel> & friends' })], 0, opts).payload,
    );
    expect(body.blocks[0]).toMatchObject({ type: 'header' });
    expect(body.blocks[1].text.text).toContain('&lt;!channel&gt; &amp; friends');
    expect(body.blocks[1].text.text).toContain('<https://lurq.run/dashboard/mcp/1|');
  });

  it('never lets a Discord message mention anyone', () => {
    const body = JSON.parse(
      formatChannel(
        'discord',
        [item({ detail: 'hey @everyone see [this](https://evil.test)' })],
        0,
        opts,
      ).payload,
    );
    expect(body.allowed_mentions).toEqual({ parse: [] });
    expect(body.embeds[0].description).not.toContain('@everyone');
    expect(body.embeds[0].description).toContain('\\[this\\]\\(https://evil.test\\)');
    expect(JSON.stringify(body.embeds).length).toBeLessThan(6000 + 2000);
  });

  it('caps each platform and reports the rest as more', () => {
    const many = Array.from({ length: 30 }, (_, i) => item({ key: `mcp:${i}` }));
    const discord = JSON.parse(formatChannel('discord', many, 0, opts).payload);
    expect(discord.embeds).toHaveLength(ITEM_CAP.discord);
    expect(discord.content).toContain('20 more');
    const slack = JSON.parse(formatChannel('slack', many, 5, opts).payload);
    expect(slack.blocks.at(-1).elements[0].text).toContain('and 15 more');
  });

  it('fits a Teams Adaptive Card under the size ceiling', () => {
    const huge = Array.from({ length: 10 }, (_, i) =>
      item({ key: `mcp:${i}`, detail: 'x'.repeat(20_000) }),
    );
    const payload = formatChannel('teams', huge, 0, opts).payload;
    expect(Buffer.byteLength(payload)).toBeLessThanOrEqual(25_000);
    expect(JSON.parse(payload).attachments[0].contentType).toBe(
      'application/vnd.microsoft.card.adaptive',
    );
  });

  it('signs a generic webhook so a receiver can verify it, and rejects replays', () => {
    const secret = 'whsec_test_secret';
    const m = formatChannel('webhook', [item()], 0, { ...opts, signingSecret: secret });
    const now = Math.floor(opts.now.getTime() / 1000);
    expect(m.headers['X-Lurq-Delivery']).toBe('channel:1:abc');
    expect(verifySignature(secret, m.headers['X-Lurq-Signature']!, m.payload, now)).toBe(true);
    expect(
      verifySignature(
        secret,
        m.headers['X-Lurq-Signature']!,
        m.payload.replace('critical', 'low'),
        now,
      ),
    ).toBe(false);
    expect(verifySignature(secret, m.headers['X-Lurq-Signature']!, m.payload, now + 3600)).toBe(
      false,
    );
    expect(JSON.parse(m.payload)).toMatchObject({
      type: 'lurq.alerts',
      items: [expect.objectContaining({ key: 'mcp:1' })],
    });
  });

  it('sends a test message in every format', () => {
    for (const kind of ['slack', 'discord', 'teams', 'webhook'] as const) {
      expect(formatTest(kind, 'high', opts).payload).toContain('lurq can post here');
    }
  });

  it('escapes the characters each platform treats specially', () => {
    expect(slackEsc('a <b> & c')).toBe('a &lt;b&gt; &amp; c');
    expect(mdEsc('*bold* @here `code`')).toBe('\\*bold\\* @​here \\`code\\`');
  });
});

describe('classify', () => {
  it.each([
    [{ status: 200, error: null }, 'sent'],
    [{ status: 204, error: null }, 'sent'],
    [{ status: 404, error: 'HTTP 404' }, 'disable'],
    [{ status: 410, error: 'HTTP 410' }, 'disable'],
    [{ status: 0, error: 'private', code: 'EPRIVATE' }, 'disable'],
    [{ status: 429, error: 'HTTP 429' }, 'retry'],
    [{ status: 503, error: 'HTTP 503' }, 'retry'],
    [{ status: 0, error: 'timed out', code: 'ETIMEDOUT' }, 'retry'],
    [{ status: 403, error: 'HTTP 403: invalid_token' }, 'reject'],
  ])('%j → %s', (outcome, kind) => {
    expect(classify(outcome).kind).toBe(kind);
  });
});

describe('plans', () => {
  it('offers alert channels from Team up', () => {
    expect([
      PLANS.free.alertChannels,
      PLANS.pro.alertChannels,
      PLANS.team.alertChannels,
      PLANS.enterprise.alertChannels,
    ]).toEqual([false, false, true, true]);
  });
});
