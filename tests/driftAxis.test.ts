/**
 * The drift board's time axis (apps/web).
 *
 * The board rules every one of its eight lanes at these positions and labels
 * them once in the header, so a wrong tick is a column that quietly misdates
 * every package on it. The two spans that matter are the extremes the picker
 * can produce: three months for the newest model on the list, nineteen for the
 * oldest.
 */
import { describe, expect, it } from 'vitest';

import { axisTicks } from '../apps/web/src/lib/drift-axis';

const at = (iso: string) => Date.parse(iso);

describe('axisTicks', () => {
  it('marks every month of a short span', () => {
    const ticks = axisTicks(at('2026-05-01'), at('2026-08-06'));
    expect(ticks.map((t) => t.label)).toEqual(['jun', 'jul', 'aug']);
  });

  it('thins a long span to at most five, and names the year only when it turns', () => {
    const ticks = axisTicks(at('2025-01-01'), at('2026-08-06'));
    expect(ticks).toHaveLength(5);
    expect(ticks.map((t) => t.label)).toEqual(['feb', 'jun', 'oct', 'feb 26', 'jun']);
  });

  it('places a tick at the share of the span it falls on', () => {
    // Real elapsed time, not an even split of the tick count: july and august
    // are both 31 days, so the boundary between them is the exact midpoint.
    expect(axisTicks(at('2026-07-01'), at('2026-09-01')).map((t) => t.at)).toEqual(['50.00%']);
    // January and February are not, and the axis says so rather than rounding
    // the two months into halves.
    expect(axisTicks(at('2026-01-01'), at('2026-03-01')).map((t) => t.at)).toEqual(['52.54%']);
  });

  it('reads both bounds as UTC', () => {
    // The cutoff is stored as the 1st. Parsed locally west of Greenwich it
    // would fall in the previous month and the axis would open a month early.
    const ticks = axisTicks(at('2026-05-01'), at('2026-06-15'));
    expect(ticks.map((t) => t.label)).toEqual(['jun']);
  });

  it('has nothing to mark inside a span with no month boundary in it', () => {
    expect(axisTicks(at('2026-05-02'), at('2026-05-30'))).toEqual([]);
    expect(axisTicks(at('2026-05-01'), at('2026-05-01'))).toEqual([]);
  });
});
