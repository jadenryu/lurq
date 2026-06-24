/**
 * Dependency-free formatting helpers for human-facing CLI output. Compact tables
 * and labeled detail views; `--json` paths bypass these entirely.
 */

const ESC = '[';
const wrap = (code: string, s: string) => `${ESC}${code}m${s}${ESC}0m`;

export const bold = (s: string) => wrap('1', s);
export const dim = (s: string) => wrap('2', s);
export const red = (s: string) => wrap('31', s);
export const green = (s: string) => wrap('32', s);
export const yellow = (s: string) => wrap('33', s);

// eslint-disable-next-line no-control-regex
const ANSI_RE = /\[[0-9;]*m/g;
const width = (s: string) => s.replace(ANSI_RE, '').length;

/** Render a simple aligned table. */
export function table(headers: string[], rows: string[][]): string {
  const widths = headers.map((h, i) => Math.max(width(h), ...rows.map((r) => width(r[i] ?? ''))));
  const pad = (s: string, w: number) => s + ' '.repeat(Math.max(0, w - width(s)));
  const line = (cells: string[]) => cells.map((c, i) => pad(c, widths[i]!)).join('  ');
  const out = [bold(line(headers)), dim(widths.map((w) => '─'.repeat(w)).join('  '))];
  for (const r of rows) out.push(line(r));
  return out.join('\n');
}

/** Render a labeled key/value detail block. */
export function detail(pairs: [string, string][]): string {
  const labelWidth = Math.max(...pairs.map(([k]) => k.length));
  return pairs.map(([k, v]) => `${dim((k + ':').padEnd(labelWidth + 1))} ${v}`).join('\n');
}

/** Compact number formatting: 1.2M, 34k, 950. */
export function formatNumber(n: number | null | undefined): string {
  if (n == null) return '—';
  if (n >= 1_000_000) return `${Math.round(n / 100_000) / 10}M`;
  if (n >= 1_000) return `${Math.round(n / 100) / 10}k`;
  return String(n);
}

export function formatDate(iso: string | null): string {
  return iso ? iso.slice(0, 10) : '—';
}

export function formatPercent(fraction: number | null | undefined): string {
  if (fraction == null) return '—';
  const pct = Math.round(fraction * 1000) / 10;
  return `${pct > 0 ? '+' : ''}${pct}%`;
}

/** Color a confidence label. */
export function confidenceLabel(c: string): string {
  if (c === 'proven') return green(c);
  if (c === 'emerging') return yellow(c);
  // `promising` (§1): high intrinsic quality, adoption-independent.
  if (c === 'promising') return green(c);
  return red(c);
}
