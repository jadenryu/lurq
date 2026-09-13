/**
 * The data every lurq email is built from. Kept apart from the templates so
 * the React Email preview server and the sender import the same shapes.
 */
import type { Severity } from '../../audit/types';

export type UrgentKind = 'mcp_rug_pull' | 'mcp_privilege' | 'breaking_release';

export interface UrgentItem {
  key: string;
  kind: UrgentKind;
  title: string;
  detail: string;
  url: string;
}

export interface DigestSummary {
  weekOf: string;
  watched: { servers: number; repos: number };
  mcpChanges: { severity: Severity; alias: string; summary: string; url: string }[];
  mcpChangeTotal: number;
  alerts: { title: string; detail: string; url: string }[];
  alertTotal: number;
  unreadable: { alias: string; status: string; url: string }[];
  stale: { alias: string; days: number; url: string }[];
}

export interface Links {
  unsubscribeUrl: string;
  settingsUrl: string;
}
