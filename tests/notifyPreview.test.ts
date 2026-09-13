/**
 * The template preview writes every message from sample data.
 */
import { mkdtempSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { runNotifyPreview } from '../src/notify/preview';

describe('notify-preview', () => {
  beforeEach(() => vi.spyOn(console, 'log').mockImplementation(() => {}));
  afterEach(() => vi.restoreAllMocks());

  it('writes both emails and all four channel payloads', async () => {
    const out = mkdtempSync(join(tmpdir(), 'lurq-preview-'));
    await runNotifyPreview({ out, open: false });
    expect(readdirSync(out).sort()).toEqual(['digest.html', 'digest.txt', 'discord.json', 'slack.json', 'teams.json', 'urgent.html', 'urgent.txt', 'webhook.json']);
    expect(readFileSync(join(out, 'urgent.txt'), 'utf8')).toMatch(/^Subject: lurq: 3 urgent changes/);
    const webhook = JSON.parse(readFileSync(join(out, 'webhook.json'), 'utf8'));
    expect(webhook.headers['X-Lurq-Signature']).toMatch(/^t=\d+,v1=[0-9a-f]{64}$/);
  });

  it('refuses to send without a Resend key', async () => {
    const prev = process.env.RESEND_API_KEY;
    delete process.env.RESEND_API_KEY;
    const { resetConfigCache } = await import('../src/core/config');
    resetConfigCache();
    await expect(runNotifyPreview({ out: mkdtempSync(join(tmpdir(), 'lurq-preview-')), open: false, sendTo: 'me@example.com' })).rejects.toThrow(/RESEND_API_KEY/);
    if (prev !== undefined) process.env.RESEND_API_KEY = prev;
    resetConfigCache();
  });
});
