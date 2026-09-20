/**
 * Public MCP endpoint changes, as the alerts an account receives.
 *
 * The probe sees a change once; every account depending on the endpoint hears
 * about it (`db/publicMcpAlerts.ts` does the routing). Here each routed change
 * becomes the same two shapes account-scan changes already take — an urgent
 * item for email and agents, and a channel item for Slack and friends — so the
 * delivery code needs no second path.
 *
 * Urgency follows the rule `sources.ts` sets for the inbox: only what needs
 * action today. A public change is urgent when it is high or critical — a
 * pinned server's contract moved in a way that breaks calls, its sign-in path
 * lost the method clients use, or it stopped answering. Everything reaches
 * channels at its own severity, and the channel's threshold decides.
 *
 * Keys carry the account. The change row is shared, but a delivery claims an
 * item key globally, so `pub:<change>` alone would let the first account's
 * email swallow everyone else's.
 */
import type { OwnerPublicChange } from '../db/publicMcpAlerts';
import type { ChannelItem } from './channels';
import type { UrgentItem } from './render';

const URGENT_SEVERITIES = new Set(['high', 'critical']);
const PREFIX = 'pub:';

export function publicItemKey(changeId: number, ownerId: string): string {
  return `${PREFIX}${changeId}:${ownerId}`;
}

/** Parse keys this module issued; anything else is ignored. */
export function parsePublicItemKey(key: string): { changeId: number; ownerId: string } | null {
  if (!key.startsWith(PREFIX)) return null;
  const rest = key.slice(PREFIX.length);
  const at = rest.indexOf(':');
  if (at <= 0) return null;
  const changeId = Number(rest.slice(0, at));
  const ownerId = rest.slice(at + 1);
  return Number.isInteger(changeId) && ownerId ? { changeId, ownerId } : null;
}

const what: Record<OwnerPublicChange['kind'], string> = {
  contract: 'changed the tools your agent calls',
  auth: 'changed how clients sign in',
  status: 'changed status',
};

function title(c: OwnerPublicChange): string {
  const label = c.label.slice(0, 80);
  const because = c.via === 'pin' ? 'since you pinned it' : 'since your last scan';
  return `${label} ${what[c.kind]} ${because}`;
}

function detail(c: OwnerPublicChange): string {
  const action =
    c.kind === 'auth'
      ? 'Check that your client can still sign in before your agent relies on it.'
      : c.kind === 'status'
        ? 'Calls to it will fail until it answers again.'
        : 'Review the change before your agent uses the server again; re-pin it once you have.';
  return `${c.summary} ${action}`.slice(0, 600);
}

const pageFor = (c: OwnerPublicChange, webUrl: string) =>
  `${webUrl}/dashboard/mcp/public/${c.endpointId}`;

/** The urgent item for a routed change, or null when it can wait for the dashboard. */
export function publicUrgentItem(c: OwnerPublicChange, webUrl: string): UrgentItem | null {
  if (!URGENT_SEVERITIES.has(c.severity)) return null;
  return {
    key: publicItemKey(c.changeId, c.ownerId),
    kind: 'mcp_public_change',
    title: title(c),
    detail: detail(c),
    url: pageFor(c, webUrl),
  };
}

export function publicChannelItem(c: OwnerPublicChange, webUrl: string): ChannelItem {
  return {
    key: publicItemKey(c.changeId, c.ownerId),
    severity: c.severity,
    source: 'mcp',
    title: title(c),
    detail: detail(c),
    url: pageFor(c, webUrl),
  };
}
