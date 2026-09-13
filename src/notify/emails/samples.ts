/**
 * Sample data for the preview server (`npm run email:dev`) and `notify-preview`.
 * No imports beyond types: the preview server bundles this on its own.
 */
import type { DigestSummary, Links, UrgentItem } from './types';

const WEB = 'https://lurq.run';

export const sampleLinks: Links = {
  unsubscribeUrl: `${WEB}/unsubscribe?token=preview&kind=urgent`,
  settingsUrl: `${WEB}/dashboard/notifications`,
};

export function sampleUrgent(): UrgentItem[] {
  return [
    {
      key: 'mcp:1',
      kind: 'mcp_rug_pull',
      title: 'notes: add_note now instructs your agent',
      detail:
        'A tool description changed after this server was scanned, and the new text tells the model what to do. Review it before your agent uses the server again.',
      url: `${WEB}/dashboard/mcp/1`,
    },
    {
      key: 'mcp:2',
      kind: 'mcp_privilege',
      title: 'fetch: fetch can now do more than you approved',
      detail: 'fetch.readOnlyHint true → false',
      url: `${WEB}/dashboard/mcp/3`,
    },
    {
      key: 'alert:3',
      kind: 'breaking_release',
      title: 'stripe 19.0.0 will install on its own in acme/billing-api',
      detail:
        'The range >=17 already admits 19.0.0, a new major (it resolves 18.5.0 today). The next clean install takes it unless the range is tightened.',
      url: `${WEB}/dashboard/repos/2`,
    },
  ];
}

export function sampleDigest(): DigestSummary {
  return {
    weekOf: '2026-09-07',
    watched: { servers: 4, repos: 3 },
    mcpChanges: [
      { severity: 'critical', alias: 'notes', summary: '1 tool(s) rewrote their description and now instruct the model: add_note', url: `${WEB}/dashboard/mcp/1` },
      { severity: 'high', alias: 'fetch', summary: '1 privilege widening(s): fetch.readOnlyHint true→false', url: `${WEB}/dashboard/mcp/3` },
      { severity: 'low', alias: 'linear', summary: 'compatible: 2 tool(s) added', url: `${WEB}/dashboard/mcp/2` },
    ],
    mcpChangeTotal: 5,
    alerts: [{ title: 'stripe 19.0.0 in acme/billing-api', detail: 'The next clean install takes it.', url: `${WEB}/dashboard/repos/2` }],
    alertTotal: 1,
    unreadable: [{ alias: 'warehouse', status: 'auth_required', url: `${WEB}/dashboard/mcp/4` }],
    stale: [],
  };
}
