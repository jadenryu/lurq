/**
 * Email preferences and unsubscribe, for the web app (issuer secret).
 *
 * The unsubscribe route answers 200 whether or not the token matched, so it
 * cannot be used to test which tokens exist.
 */
import type { Express, Request, RequestHandler, Response } from 'express';
import { formatError } from '../core/errors';
import { logger } from '../core/logger';
import type { Database } from '../db/client';
import { getOrCreatePreferences, setPreferences, unsubscribeByToken } from '../db/notifications';
import { emailConfigured } from '../notify/config';

export interface NotificationRouteDeps {
  db: Database;
  requireIssuerSecret: RequestHandler;
  ownerFrom: (req: Request) => string;
}

const TOKEN = /^[A-Za-z0-9_-]{20,100}$/;

const view = (p: { urgentEmail: boolean; weeklyDigest: boolean }) => ({
  urgentEmail: p.urgentEmail,
  weeklyDigest: p.weeklyDigest,
  emailConfigured: emailConfigured(),
});

export function registerNotificationRoutes(app: Express, d: NotificationRouteDeps): void {
  app.get('/notification-preferences', d.requireIssuerSecret, async (req: Request, res: Response) => {
    const ownerId = d.ownerFrom(req);
    if (!ownerId) {
      res.status(400).json({ error: 'ownerId is required.' });
      return;
    }
    try {
      res.status(200).json(view(await getOrCreatePreferences(d.db, ownerId)));
    } catch (err) {
      logger.error('notification preferences read failed:', formatError(err));
      res.status(500).json({ error: 'Could not read email settings.' });
    }
  });

  app.put('/notification-preferences', d.requireIssuerSecret, async (req: Request, res: Response) => {
    const ownerId = d.ownerFrom(req);
    const body = (req.body ?? {}) as Record<string, unknown>;
    const patch: { urgentEmail?: boolean; weeklyDigest?: boolean } = {};
    for (const key of ['urgentEmail', 'weeklyDigest'] as const) {
      if (body[key] === undefined) continue;
      if (typeof body[key] !== 'boolean') {
        res.status(400).json({ error: `${key} must be true or false.` });
        return;
      }
      patch[key] = body[key];
    }
    if (!ownerId || Object.keys(patch).length === 0) {
      res.status(400).json({ error: 'ownerId and at least one setting are required.' });
      return;
    }
    try {
      res.status(200).json(view(await setPreferences(d.db, ownerId, patch)));
    } catch (err) {
      logger.error('notification preferences write failed:', formatError(err));
      res.status(500).json({ error: 'Could not save email settings.' });
    }
  });

  app.post('/notifications/unsubscribe', d.requireIssuerSecret, async (req: Request, res: Response) => {
    const { token, kind } = (req.body ?? {}) as { token?: unknown; kind?: unknown };
    if (typeof token !== 'string' || !TOKEN.test(token) || (kind !== 'urgent' && kind !== 'digest')) {
      res.status(400).json({ error: 'A valid token and kind are required.' });
      return;
    }
    try {
      await unsubscribeByToken(d.db, token, kind);
      res.status(200).json({ ok: true });
    } catch (err) {
      logger.error('unsubscribe failed:', formatError(err));
      res.status(500).json({ error: 'Could not unsubscribe. Try again.' });
    }
  });
}
