/**
 * `POST /surfaces` — an author files their own package's export surface.
 *
 * API key only. There is no issuer-secret twin here on purpose: the dashboard
 * has nothing to publish, because the surface only exists on the machine that
 * built the package.
 *
 * Kept out of http.ts so the route can be mounted on a bare express app in
 * tests with the real guards swapped for fakes, exactly like the MCP scan
 * upload it is modelled on.
 */
import type { Express, Request, RequestHandler, Response } from 'express';
import { capture } from '../core/analytics';
import { formatError } from '../core/errors';
import { logger } from '../core/logger';
import type { Database } from '../db/client';
import { tenantIdFor } from '../db/graph';
import {
  countPrivatePackages,
  MAX_PRIVATE_PACKAGES_PER_OWNER,
  publishedAlready,
  publishSurface,
  PublishSchema,
} from '../surface/publish';

export const SURFACE_PUBLISH_PATH = '/surfaces';

export interface SurfaceRouteDeps {
  db: Database;
  ipLimiter: RequestHandler;
  auth: RequestHandler;
  keyLimiter: RequestHandler;
  quota: RequestHandler;
  /** JSON parser at PUBLISH_BODY_LIMIT. Mounted AFTER auth, so an anonymous
   *  caller can never make the server parse four megabytes. */
  bigJson: RequestHandler;
  keyOwner: (req: Request, res: Response) => string | null;
}

export function registerSurfaceRoutes(app: Express, d: SurfaceRouteDeps): void {
  app.post(
    SURFACE_PUBLISH_PATH,
    d.ipLimiter,
    d.auth,
    d.keyLimiter,
    d.quota,
    d.bigJson,
    async (req: Request, res: Response) => {
      const ownerId = d.keyOwner(req, res);
      if (!ownerId) return;

      const parsed = PublishSchema.safeParse(req.body);
      if (!parsed.success) {
        // Counted, not echoed: the reason text would quote what the client
        // sent, and the point is to see a spike, not to read the body.
        capture(ownerId, 'surface_publish_rejected', { reason: 'invalid_body' });
        res.status(400).json({
          error: parsed.error.issues
            .slice(0, 3)
            .map((i) => `${i.path.join('.')}: ${i.message}`)
            .join('; '),
        });
        return;
      }

      try {
        const tenantId = await tenantIdFor(d.db, ownerId);

        // Checked against the package NAME, not the version: publishing every
        // release of one package is the intended workflow and must never be
        // what trips the cap.
        const tracked = await countPrivatePackages(d.db, tenantId);
        if (tracked >= MAX_PRIVATE_PACKAGES_PER_OWNER) {
          const known = await publishedAlready(d.db, tenantId, parsed.data.package);
          if (!known) {
            capture(ownerId, 'surface_publish_rejected', { reason: 'package_cap' });
            res.status(429).json({
              error: `this account already tracks ${MAX_PRIVATE_PACKAGES_PER_OWNER} private packages`,
            });
            return;
          }
        }

        const result = await publishSurface(d.db, parsed.data, tenantId);
        capture(ownerId, 'surface_published', {
          symbols: result.symbolsWritten,
          verdict: result.verdict,
        });
        res.json(result);
      } catch (err) {
        logger.error('surface publish failed:', formatError(err));
        res.status(500).json({ error: 'Could not publish the surface.' });
      }
    },
  );
}
