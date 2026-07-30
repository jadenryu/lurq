/**
 * Pure formatting helpers shared by dashboard server components and the client
 * chart primitives.
 *
 * These deliberately live outside `components/dashboard/charts.tsx`. That module is
 * `"use client"`, and a plain function exported from a client module cannot be
 * *called* from a server component — React only allows client exports to be
 * rendered as components or passed as props. Keeping them here lets both sides
 * import the same implementation.
 */

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** Format a 'YYYY-MM-DD' day without going through Date (avoids TZ off-by-one). */
export function fmtDay(iso: string): string {
  const [, m, d] = iso.split("-");
  return `${MONTHS[Number(m) - 1] ?? m} ${Number(d)}`;
}

/** Abbreviate large counts for tight slots: 942 · 12.9K · 3.6M. */
export function compact(n: number): string {
  if (n < 1000) return String(n);
  if (n < 1_000_000) return `${(n / 1000).toFixed(n < 10_000 ? 1 : 0)}K`;
  return `${(n / 1_000_000).toFixed(1)}M`;
}

/** Coarse "how long ago", for feed rows where an exact timestamp is noise. */
export function relativeTime(iso: string): string {
  const minutes = Math.floor((Date.now() - new Date(iso).getTime()) / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(iso).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}
