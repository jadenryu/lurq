/**
 * The audit log's shapes, apart from the server-only loader in audit.ts.
 *
 * llm-export.ts needs these types and is also unit-tested from the repo root,
 * whose tsc cannot resolve the web app's `@/` paths or `server-only`. Importing
 * them from audit.ts dragged that whole module into the root typecheck.
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
