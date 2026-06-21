import { describe, it, expect } from 'vitest';
import { table, formatNumber, formatPercent, formatDate } from '../src/cli/format';

// Strip ANSI without a control-character regex: split on ESC, drop the leading
// `[<code>m` from each following segment.
const plain = (s: string) =>
  s
    .split(String.fromCharCode(27))
    .map((seg, i) => (i === 0 ? seg : seg.replace(/^\[[0-9;]*m/, '')))
    .join('');

describe('formatNumber', () => {
  it('formats with k/M suffixes', () => {
    expect(formatNumber(950)).toBe('950');
    expect(formatNumber(34_200)).toBe('34.2k');
    expect(formatNumber(145_648_579)).toBe('145.6M');
    expect(formatNumber(null)).toBe('—');
  });
});

describe('formatPercent', () => {
  it('formats signed percentages', () => {
    expect(formatPercent(0.044)).toBe('+4.4%');
    expect(formatPercent(-0.056)).toBe('-5.6%');
    expect(formatPercent(null)).toBe('—');
  });
});

describe('formatDate', () => {
  it('keeps the date portion', () => {
    expect(formatDate('2026-06-21T00:00:00.000Z')).toBe('2026-06-21');
    expect(formatDate(null)).toBe('—');
  });
});

describe('table', () => {
  it('aligns columns and includes a header separator', () => {
    const out = plain(table(['Name', 'Health'], [['react', '90'], ['vue', '89']]));
    const lines = out.split('\n');
    expect(lines[0]).toContain('Name');
    expect(lines[0]).toContain('Health');
    expect(lines).toHaveLength(4); // header, separator, 2 rows
    expect(lines[2]).toMatch(/^react\s+90/);
  });
});
