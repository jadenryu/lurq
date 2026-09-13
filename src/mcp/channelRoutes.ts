/**
 * Alert channels for the dashboard (issuer secret).
 *
 * Adding a channel posts a test message before anything is stored, so a typo in
 * a URL is an error at the form rather than a silent channel that never posts.
 * The webhook signing secret is returned once, at creation, and never again.
 */
import { randomBytes } from 'node:crypto';
import type { Express, Request, RequestHandler, Response } from 'express';
import { SEVERITY_RANK, type Severity } from '../audit/types';
import { formatError } from '../core/errors';
import { logger } from '../core/logger';
import { open, seal } from '../core/secretBox';
import type { Database } from '../db/client';
import { getChannel, insertChannel, listChannels, removeChannel, updateChannel } from '../db/notifications';
import type { NotificationChannelRow } from '../db/schema';
import { formatTest, type Formatted } from '../notify/channels';
import { validateChannelUrl, type ChannelKind, type PostOutcome } from '../notify/safeHttp';

export const MAX_CHANNELS_PER_OWNER = 10;

export interface ChannelRouteDeps {
  db: Database;
  requireIssuerSecret: RequestHandler;
  ownerFrom: (req: Request) => string;
  /** Null when channels are not configured on this deployment. */
  secretsKey: Buffer | null;
  webUrl: string;
  allowed: (ownerId: string) => Promise<boolean>;
  post: (url: string, message: Formatted) => Promise<PostOutcome>;
}

const KINDS: ChannelKind[] = ['slack', 'discord', 'teams', 'webhook'];
const SEVERITIES: Severity[] = ['critical', 'high', 'moderate', 'low'];

export function channelView(c: NotificationChannelRow) {
  return {
    id: c.id,
    kind: c.kind,
    label: c.label,
    urlHint: c.urlHint,
    minSeverity: c.minSeverity,
    enabled: c.enabled,
    disabledReason: c.disabledReason,
    lastDeliveredAt: c.lastDeliveredAt,
    lastError: c.lastError,
    createdAt: c.createdAt,
  };
}

export function urlHint(url: URL): string {
  const tail = `${url.pathname}${url.search}`.slice(-4);
  return `${url.host}/…${tail}`;
}

export function registerChannelRoutes(app: Express, d: ChannelRouteDeps): void {
  const owner = (req: Request, res: Response): string | null => {
    const ownerId = d.ownerFrom(req);
    if (!ownerId) res.status(400).json({ error: 'ownerId is required.' });
    return ownerId || null;
  };
  const numericId = (req: Request, res: Response): number | null => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      res.status(400).json({ error: 'A numeric id is required.' });
      return null;
    }
    return id;
  };
  const configured = (res: Response): Buffer | null => {
    if (!d.secretsKey) res.status(503).json({ error: 'Alert channels are not configured on this deployment.' });
    return d.secretsKey;
  };
  const test = (kind: ChannelKind, url: string, minSeverity: Severity, signingSecret: string | null) =>
    d.post(url, formatTest(kind, minSeverity, { deliveryId: `test:${Date.now()}`, dashboardUrl: `${d.webUrl}/dashboard/notifications`, now: new Date(), signingSecret }));

  app.get('/notification-channels', d.requireIssuerSecret, async (req: Request, res: Response) => {
    const ownerId = owner(req, res);
    if (!ownerId) return;
    try {
      const [channels, allowed] = await Promise.all([listChannels(d.db, ownerId), d.allowed(ownerId).catch(() => true)]);
      res.status(200).json({ channels: channels.map(channelView), allowed, configured: Boolean(d.secretsKey) });
    } catch (err) {
      logger.error('channel list failed:', formatError(err));
      res.status(500).json({ error: 'Could not read alert channels.' });
    }
  });

  app.post('/notification-channels', d.requireIssuerSecret, async (req: Request, res: Response) => {
    const ownerId = owner(req, res);
    if (!ownerId) return;
    const key = configured(res);
    if (!key) return;
    const body = (req.body ?? {}) as Record<string, unknown>;
    const kind = body.kind as ChannelKind;
    const minSeverity = (body.minSeverity ?? 'high') as Severity;
    if (!KINDS.includes(kind)) return void res.status(400).json({ error: 'kind must be slack, discord, teams or webhook.' });
    if (!SEVERITIES.includes(minSeverity)) return void res.status(400).json({ error: 'minSeverity must be critical, high, moderate or low.' });
    const label = typeof body.label === 'string' ? body.label.trim().slice(0, 80) || null : null;
    const check = validateChannelUrl(kind, typeof body.url === 'string' ? body.url : '');
    if (!check.ok) return void res.status(400).json({ error: check.error });

    try {
      // Plan gate fails open on a lookup error, like key issuance.
      if (!(await d.allowed(ownerId).catch(() => true))) {
        return void res.status(403).json({ error: 'Slack, Discord, Teams and webhook alerts come with the Team plan.' });
      }
      if ((await listChannels(d.db, ownerId)).length >= MAX_CHANNELS_PER_OWNER) {
        return void res.status(400).json({ error: `An account can have up to ${MAX_CHANNELS_PER_OWNER} alert channels.` });
      }
      const signingSecret = kind === 'webhook' ? randomBytes(32).toString('base64url') : null;
      const outcome = await test(kind, check.url.toString(), minSeverity, signingSecret);
      if (outcome.status < 200 || outcome.status >= 300) {
        return void res.status(400).json({ error: `lurq could not post to that URL: ${outcome.error ?? `HTTP ${outcome.status}`}` });
      }
      const channel = await insertChannel(d.db, {
        ownerId,
        kind,
        label,
        minSeverity,
        urlCiphertext: seal(check.url.toString(), key, ownerId),
        urlHint: urlHint(check.url),
        signingSecretCiphertext: signingSecret ? seal(signingSecret, key, ownerId) : null,
        lastDeliveredAt: new Date(),
      });
      res.status(201).json({ channel: channelView(channel), ...(signingSecret ? { signingSecret } : {}) });
    } catch (err) {
      logger.error('channel create failed:', formatError(err));
      res.status(500).json({ error: 'Could not add the channel.' });
    }
  });

  app.patch('/notification-channels/:id', d.requireIssuerSecret, async (req: Request, res: Response) => {
    const ownerId = owner(req, res);
    if (!ownerId) return;
    const id = numericId(req, res);
    if (!id) return;
    const body = (req.body ?? {}) as Record<string, unknown>;
    const patch: Parameters<typeof updateChannel>[3] = {};
    if (body.enabled !== undefined) {
      if (typeof body.enabled !== 'boolean') return void res.status(400).json({ error: 'enabled must be true or false.' });
      patch.enabled = body.enabled;
      // Turning a switched-off channel back on is the owner saying "try again".
      if (body.enabled) Object.assign(patch, { consecutiveFailures: 0, disabledReason: null });
    }
    if (body.minSeverity !== undefined) {
      if (!SEVERITIES.includes(body.minSeverity as Severity)) return void res.status(400).json({ error: 'minSeverity must be critical, high, moderate or low.' });
      patch.minSeverity = body.minSeverity as Severity;
    }
    if (body.label !== undefined) patch.label = typeof body.label === 'string' ? body.label.trim().slice(0, 80) || null : null;
    if (!Object.keys(patch).length) return void res.status(400).json({ error: 'Nothing to change.' });
    try {
      const row = await updateChannel(d.db, ownerId, id, patch);
      if (!row) return void res.status(404).json({ error: 'No such channel for this account.' });
      res.status(200).json({ channel: channelView(row) });
    } catch (err) {
      logger.error('channel update failed:', formatError(err));
      res.status(500).json({ error: 'Could not update the channel.' });
    }
  });

  app.post('/notification-channels/:id/test', d.requireIssuerSecret, async (req: Request, res: Response) => {
    const ownerId = owner(req, res);
    if (!ownerId) return;
    const id = numericId(req, res);
    if (!id) return;
    const key = configured(res);
    if (!key) return;
    try {
      const channel = await getChannel(d.db, ownerId, id);
      if (!channel) return void res.status(404).json({ error: 'No such channel for this account.' });
      const url = open(channel.urlCiphertext, key, ownerId);
      const secret = channel.signingSecretCiphertext ? open(channel.signingSecretCiphertext, key, ownerId) : null;
      const outcome = await test(channel.kind, url, channel.minSeverity, secret);
      const ok = outcome.status >= 200 && outcome.status < 300;
      await updateChannel(d.db, ownerId, id, ok ? { lastDeliveredAt: new Date(), lastError: null } : { lastError: outcome.error });
      res.status(200).json({ ok, error: ok ? null : outcome.error });
    } catch (err) {
      logger.error('channel test failed:', formatError(err));
      res.status(500).json({ error: 'Could not test the channel.' });
    }
  });

  app.delete('/notification-channels/:id', d.requireIssuerSecret, async (req: Request, res: Response) => {
    const ownerId = owner(req, res);
    if (!ownerId) return;
    const id = numericId(req, res);
    if (!id) return;
    try {
      if (!(await removeChannel(d.db, ownerId, id))) return void res.status(404).json({ error: 'No such channel for this account.' });
      res.status(200).json({ removed: true });
    } catch (err) {
      logger.error('channel remove failed:', formatError(err));
      res.status(500).json({ error: 'Could not remove the channel.' });
    }
  });
}

export { SEVERITY_RANK };
