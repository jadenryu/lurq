import { afterEach, describe, it, expect } from 'vitest';
import { bold, colorEnabled, table, formatNumber, formatPercent, formatDate } from '../src/cli/format';

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
    expect(formatNumber(null)).toBe('-');
  });
});

describe('formatPercent', () => {
  it('formats signed percentages', () => {
    expect(formatPercent(0.044)).toBe('+4.4%');
    expect(formatPercent(-0.056)).toBe('-5.6%');
    expect(formatPercent(null)).toBe('-');
  });
});

describe('formatDate', () => {
  it('keeps the date portion', () => {
    expect(formatDate('2026-06-21T00:00:00.000Z')).toBe('2026-06-21');
    expect(formatDate(null)).toBe('-');
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

describe('colour', () => {
  const saved = { NO_COLOR: process.env.NO_COLOR, FORCE_COLOR: process.env.FORCE_COLOR, tty: process.stdout.isTTY };
  const set = (env: { NO_COLOR?: string; FORCE_COLOR?: string }, tty: boolean) => {
    for (const k of ['NO_COLOR', 'FORCE_COLOR'] as const) {
      if (env[k] === undefined) delete process.env[k];
      else process.env[k] = env[k];
    }
    Object.defineProperty(process.stdout, 'isTTY', { value: tty, configurable: true });
  };
  afterEach(() => {
    set({ NO_COLOR: saved.NO_COLOR, FORCE_COLOR: saved.FORCE_COLOR }, saved.tty);
  });

  it('writes no escape codes when stdout is not a terminal', () => {
    set({}, false);
    expect(bold('x')).toBe('x');
  });

  it('colours a terminal, unless NO_COLOR is set', () => {
    set({}, true);
    expect(bold('x')).not.toBe('x');
    set({ NO_COLOR: '1' }, true);
    expect(bold('x')).toBe('x');
  });

  it('FORCE_COLOR colours a pipe, and FORCE_COLOR=0 silences a terminal', () => {
    set({ FORCE_COLOR: '1' }, false);
    expect(colorEnabled()).toBe(true);
    set({ FORCE_COLOR: '0' }, true);
    expect(colorEnabled()).toBe(false);
  });
});
