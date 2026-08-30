import "server-only";
import { loadAlerts, loadKeys, loadRepos } from "@/lib/dashboard-data";

/**
 * The workspace audit log, composed rather than fetched.
 *
 * ponytail: NO `audit_events` TABLE AND NO NEW ENDPOINT. Every event below is
 * already a timestamped row the dashboard reads for some other page — a key's
 * `createdAt`/`revokedAt`, a repo's `lastScanAt`, an alert's `createdAt`. An
 * audit log over them is a view, not a data source, so this merges three
 * existing loaders and sorts. That also means it works against the deployed
 * backend today: a new endpoint in src/mcp/http.ts would have needed a Railway
 * redeploy before this page could render anything at all.
 *
 * ponytail: a real event table when the log has to record something no other
 * page already stores — a policy edit, a settings change, a failed auth. Those
 * leave no row behind today, so no view can show them, and that is the point at
 * which writing events becomes the cheaper option. The gap is named in the
 * page's footnote rather than hidden.
 *
 * The three reads are the same `cache()`d loaders the other pages call, so a
 * user landing here from the overview pays for at most one of them again.
 */

export type AuditKind = "key" | "scan" | "alert";

export interface AuditEvent {
  /** Stable within a render: used as the React key. */
  id: string;
  kind: AuditKind;
  at: string;
  summary: string;
  detail: string | null;
  /** Set when the event is something the reader should look at. */
  tone: "neutral" | "warn" | "bad";
}

export async function loadAuditLog(): Promise<{ events: AuditEvent[]; demo: boolean }> {
  const [keys, repos, alerts] = await Promise.all([loadKeys(), loadRepos(), loadAlerts()]);
  const events: AuditEvent[] = [];

  for (const key of keys.data) {
    const name = key.label ?? key.prefix;
    events.push({
      id: `key-${key.id}-created`,
      kind: "key",
      at: key.createdAt,
      summary: `api key ${name} created`,
      detail: `tier ${key.tier}`,
      tone: "neutral",
    });
    // Revocation is its own event, not a status on the first one. "created and
    // later revoked" is two things that happened at two times, and a log that
    // collapses them cannot answer when the key stopped working.
    if (key.revokedAt) {
      events.push({
        id: `key-${key.id}-revoked`,
        kind: "key",
        at: key.revokedAt,
        summary: `api key ${name} revoked`,
        detail: null,
        tone: "warn",
      });
    }
  }

  for (const repo of repos.data.repos) {
    if (!repo.lastScanAt) continue;
    events.push({
      id: `scan-${repo.id}`,
      kind: "scan",
      at: repo.lastScanAt,
      summary: repo.lastScanError
        ? `scan of ${repo.fullName} failed`
        : `scanned ${repo.fullName}`,
      detail: repo.lastScanError,
      tone: repo.lastScanError ? "bad" : "neutral",
    });
  }

  for (const alert of alerts.data) {
    events.push({
      id: `alert-${alert.id}`,
      kind: "alert",
      at: alert.createdAt,
      summary: `${alert.packageName} ${alert.toVersion} affects ${alert.repoFullName}`,
      detail: alert.inRange
        ? `${alert.range} already admits it — the next clean install takes it`
        : `${alert.range} holds at ${alert.fromVersion ?? "unknown"}`,
      tone: alert.inRange ? "bad" : "warn",
    });
  }

  events.sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
  return { events, demo: keys.demo || repos.demo || alerts.demo };
}
