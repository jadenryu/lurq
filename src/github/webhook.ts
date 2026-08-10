/**
 * GitHub App webhook: signature check + payload interpretation.
 *
 * Why this exists at all: the connect flow only ever takes a *snapshot* of an
 * installation. People manage app access from github.com/settings/installations,
 * not from our dashboard, so without a webhook a repo added there never appears
 * and the user concludes lurq is broken. (Removal degrades honestly on its own —
 * the next scan 404s and says "reconnect" — but an addition fails silently, and
 * silence is the worse failure.)
 *
 * Everything here is pure: verification takes bytes and a header, parsing takes
 * an event name and an object. The DB and GitHub calls stay in the route, so the
 * security-relevant half can be tested without either.
 *
 * The payload is fully attacker-controlled until the signature verifies, and even
 * after that its repo objects are minimal — `full_name` and `private`, no
 * `default_branch`. So names are all we take from it: the route re-reads the real
 * inventory from the API rather than trusting a webhook to describe a repo.
 */
import { createHmac, timingSafeEqual } from 'node:crypto';

/** What a delivery means for us. Anything we don't act on is `ignored`. */
export type WebhookAction =
  | {
      kind: 'repos-changed';
      installationId: number;
      added: string[];
      removed: string[];
    }
  | { kind: 'uninstalled'; installationId: number }
  | { kind: 'ignored'; reason: string };

/**
 * True when `body` was signed with `secret`, per `X-Hub-Signature-256`.
 *
 * Takes the raw bytes on purpose: GitHub signs what it sent, and a re-serialized
 * `JSON.parse` result is not byte-identical (key order, unicode escapes, spacing),
 * so verifying against a re-stringified object fails for legitimate deliveries.
 */
export function verifyWebhookSignature(
  secret: string,
  body: Buffer | string,
  header: string | undefined,
): boolean {
  if (!header?.startsWith('sha256=')) return false;
  const presented = Buffer.from(header.slice(7), 'hex');
  const expected = createHmac('sha256', secret).update(body).digest();
  // A wrong-length hex string (or non-hex junk) is a mismatch, not a crash —
  // timingSafeEqual throws on unequal lengths.
  return presented.length === expected.length && timingSafeEqual(presented, expected);
}

/** Repo full names out of an untrusted `[{ full_name }]` array. */
function fullNames(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) =>
      entry && typeof entry === 'object' && typeof (entry as { full_name?: unknown }).full_name === 'string'
        ? (entry as { full_name: string }).full_name
        : null,
    )
    .filter((name): name is string => name !== null);
}

function installationId(payload: Record<string, unknown>): number | null {
  const install = payload.installation;
  const id = install && typeof install === 'object' ? (install as { id?: unknown }).id : null;
  return typeof id === 'number' && Number.isInteger(id) && id > 0 ? id : null;
}

/**
 * Decide what a delivery asks us to do.
 *
 * `installation.created` is deliberately ignored: the post-install redirect is
 * the only place that knows *which lurq user* installed the app, and it upserts
 * the repos itself. Acting on `created` here would race it with no owner to
 * attribute the repos to. `suspend`/`unsuspend` are ignored too — suspension is
 * reversible and deleting the rows would throw away the user's autopilot policy
 * to save them a scan error that already reads correctly.
 */
export function parseWebhook(
  event: string | undefined,
  payload: unknown,
): WebhookAction {
  if (!payload || typeof payload !== 'object') return { kind: 'ignored', reason: 'no payload' };
  const body = payload as Record<string, unknown>;
  const id = installationId(body);
  if (id === null) return { kind: 'ignored', reason: 'no installation id' };
  const action = typeof body.action === 'string' ? body.action : '';

  if (event === 'installation_repositories') {
    // Both arrays are always present, one of them empty. Reading both rather
    // than branching on `action` means a delivery carrying each cannot lose half.
    const added = fullNames(body.repositories_added);
    const removed = fullNames(body.repositories_removed);
    if (added.length === 0 && removed.length === 0) {
      return { kind: 'ignored', reason: 'no repository changes' };
    }
    return { kind: 'repos-changed', installationId: id, added, removed };
  }

  if (event === 'installation') {
    if (action === 'deleted') return { kind: 'uninstalled', installationId: id };
    if (action === 'added' || action === 'removed') {
      // Older deliveries put repo changes on the `installation` event.
      const added = fullNames(body.repositories_added);
      const removed = fullNames(body.repositories_removed);
      if (added.length || removed.length) {
        return { kind: 'repos-changed', installationId: id, added, removed };
      }
    }
    return { kind: 'ignored', reason: `installation.${action || 'unknown'}` };
  }

  return { kind: 'ignored', reason: `event ${event ?? 'unknown'}` };
}
