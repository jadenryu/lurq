/**
 * What moved on a public endpoint between two probes, and how much it matters.
 *
 * Three kinds of change, because they break different people:
 *
 *   - status: the endpoint went dark, came back, or started (or stopped)
 *     refusing requests without credentials
 *   - contract: the tools the model sees changed — scored by the same
 *     `diffSnapshots` account scans use, so a rug pull reads the same wherever
 *     it is found
 *   - auth: the sign-in path changed — a new authorization server, or a
 *     registration method or PKCE support that clients relied on disappeared.
 *     Nothing in a tool list reveals this, and it is the class of break the
 *     issue trackers of hosted servers fill up with.
 *
 * Pure: the drain loads what it needs and writes what this returns.
 */
import { createHash } from 'node:crypto';
import type { Severity } from '../audit/types';
import type { EndpointChangeInput, NewMcpContract } from '../db/remoteEndpoints';
import { analyzeServer, diffSnapshots, type DiffInput } from '../mcpScan/analyze';
import { ANALYZER_VERSION } from '../mcpScan/ingest';
import { canonicalJson, contentHash, contractHash, type Snapshot } from '../mcpScan/snapshot';
import { DEAD_STATUSES, type AuthProfile, type EndpointStatus, type ProbeResult } from './types';

const sha = (s: string) => createHash('sha256').update(s).digest('hex');

/**
 * Address of what a client needs to sign in. Null when the probe established
 * nothing about auth, so an outage never registers as an auth change. Declared
 * headers are excluded: they come from the registry, not from the endpoint.
 */
export function authHash(auth: AuthProfile): string | null {
  if (auth.mode === 'unknown') return null;
  const o = auth.oauth;
  return sha(
    canonicalJson({
      mode: auth.mode,
      oauth: o
        ? {
            authorizationServers: [...o.authorizationServers].sort(),
            issuer: o.issuer,
            cimd: o.cimd,
            dcr: o.dcr,
            pkceS256: o.pkceS256,
            issParameter: o.issParameter,
            scopes: o.scopesSupported ? [...o.scopesSupported].sort() : null,
          }
        : null,
    }),
  );
}

/** A probed snapshot as a content-addressed `mcp_contracts` row. */
export function contractRow(snapshot: Snapshot): NewMcpContract {
  const body = {
    tools: snapshot.tools,
    prompts: snapshot.prompts,
    resourceTemplates: snapshot.resourceTemplates,
    instructions: snapshot.instructions,
  };
  return {
    contentHash: contentHash(snapshot),
    contractHash: contractHash(snapshot),
    ...body,
    toolCount: snapshot.tools.length,
    bytes: JSON.stringify(body).length,
    analysis: analyzeServer(snapshot),
    analyzerVersion: ANALYZER_VERSION,
  };
}

const ALIVE: ReadonlySet<EndpointStatus> = new Set(['open', 'auth_required']);

export function describeAuthChange(
  before: AuthProfile,
  after: AuthProfile,
): { severity: Severity; summary: string } {
  if (before.mode !== after.mode) {
    if (before.mode === 'none') {
      return {
        severity: 'high',
        summary:
          after.mode === 'oauth'
            ? 'now requires OAuth sign-in'
            : 'now requires a key or token configured by hand',
      };
    }
    if (after.mode === 'none')
      return { severity: 'moderate', summary: 'no longer requires credentials' };
    if (before.mode === 'oauth')
      return {
        severity: 'high',
        summary: 'OAuth discovery disappeared; clients can no longer sign in on their own',
      };
    return { severity: 'moderate', summary: 'now supports OAuth sign-in' };
  }
  const a = before.oauth;
  const b = after.oauth;
  if (!a || !b) return { severity: 'moderate', summary: 'authorization metadata changed' };

  const parts: string[] = [];
  let severity: Severity = 'low';
  const raise = (s: Severity) => {
    const rank: Record<Severity, number> = { info: 0, low: 1, moderate: 2, high: 3, critical: 4 };
    if (rank[s] > rank[severity]) severity = s;
  };
  if (a.issuer !== b.issuer) {
    parts.push(
      `authorization server changed (${a.issuer ?? 'none'} → ${b.issuer ?? 'none'}); existing client registrations must be redone`,
    );
    raise('high');
  }
  if (a.cimd && !b.cimd) {
    parts.push(
      'Client ID Metadata Documents no longer offered; clients that register that way will fail',
    );
    raise('high');
  }
  if (a.dcr && !b.dcr) {
    parts.push(
      'Dynamic Client Registration no longer offered; clients that register that way will fail',
    );
    raise('high');
  }
  if (a.pkceS256 && !b.pkceS256) {
    parts.push('PKCE S256 no longer advertised; compliant clients will refuse to sign in');
    raise('high');
  }
  if (!a.cimd && b.cimd) parts.push('now offers Client ID Metadata Documents');
  if (!a.dcr && b.dcr) parts.push('now offers Dynamic Client Registration');
  if (!a.pkceS256 && b.pkceS256) parts.push('now advertises PKCE S256');
  if (
    canonicalJson([...(a.scopesSupported ?? [])].sort()) !==
    canonicalJson([...(b.scopesSupported ?? [])].sort())
  ) {
    parts.push('supported scopes changed');
    raise('moderate');
  }
  return { severity, summary: parts.length ? parts.join('; ') : 'authorization metadata changed' };
}

export interface PreviousState {
  status: EndpointStatus | null;
  contentHash: string | null;
  authHash: string | null;
  auth: AuthProfile | null;
  /** The contract behind `contentHash`, loaded only when the hash moved. */
  contract: DiffInput | null;
}

export interface NextState {
  result: ProbeResult;
  contentHash: string | null;
  authHash: string | null;
}

export function detectChanges(
  prev: PreviousState,
  next: NextState,
  label: string,
): EndpointChangeInput[] {
  const out: EndpointChangeInput[] = [];
  const now = next.result.status;

  if (prev.status && prev.status !== now) {
    const change = (severity: Severity, summary: string) =>
      out.push({
        kind: 'status',
        fromKey: prev.status!,
        toKey: now,
        severity,
        summary: `${label} ${summary}`,
      });
    if (ALIVE.has(prev.status) && DEAD_STATUSES.has(now))
      change('high', `stopped answering (${prev.status} → ${now})`);
    else if (DEAD_STATUSES.has(prev.status) && ALIVE.has(now))
      change('low', `is answering again (${now})`);
    else if (prev.status === 'open' && now === 'auth_required')
      change(
        'high',
        'now refuses requests without credentials; clients connected without them will fail',
      );
    else if (prev.status === 'auth_required' && now === 'open')
      change('moderate', 'now answers without credentials');
  }

  if (
    prev.contentHash &&
    next.contentHash &&
    prev.contentHash !== next.contentHash &&
    prev.contract &&
    next.result.snapshot
  ) {
    const diff = diffSnapshots(prev.contract, next.result.snapshot, label);
    if (!diff.unchanged) {
      out.push({
        kind: 'contract',
        fromKey: prev.contentHash,
        toKey: next.contentHash,
        severity: diff.severity,
        summary: diff.summary,
        diff,
      });
    }
  }

  if (prev.authHash && next.authHash && prev.authHash !== next.authHash && prev.auth) {
    const { severity, summary } = describeAuthChange(prev.auth, next.result.auth);
    out.push({
      kind: 'auth',
      fromKey: prev.authHash,
      toKey: next.authHash,
      severity,
      summary: `${label}: ${summary}`,
    });
  }
  return out;
}
