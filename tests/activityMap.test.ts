/**
 * The dashboard activity map's calendar arithmetic (apps/web).
 *
 * Every function here fails silently: a grid padded with the wrong number of
 * leading cells renders perfectly while putting each day on the wrong weekday
 * row, and a misplaced month label misdates a whole quarter. Looking at the page
 * does not catch either, so they are pinned here instead.
 */
import { describe, expect, it } from 'vitest';
import {
  currentStreak,
  level,
  longestStreak,
  monthLabels,
  thresholds,
  toWeeks,
  type Point,
} from '../apps/web/src/lib/activity-map';

/** `days` consecutive days from `start`, with the given counts. */
function series(start: string, counts: number[]): Point[] {
  const base = new Date(`${start}T00:00:00Z`).getTime();
  return counts.map((count, i) => ({
    date: new Date(base + i * 86_400_000).toISOString().slice(0, 10),
    count,
  }));
}

describe('toWeeks', () => {
  it('pads the first column so every row is one weekday', () => {
    // 2026-01-01 is a Thursday: three blanks ahead of it (Sun, Mon, Tue, Wed→…).
    const weeks = toWeeks(series('2026-01-01', Array(14).fill(1)));
    expect(weeks[0]!.slice(0, 4)).toEqual([null, null, null, null]);
    expect(weeks[0]![4]).toMatchObject({ date: '2026-01-01' });
    // Same weekday must land on the same row a week later.
    expect(weeks[1]![4]).toMatchObject({ date: '2026-01-08' });
  });

  it('starts flush when the series already begins on a Sunday', () => {
    const weeks = toWeeks(series('2026-01-04', Array(7).fill(1)));
    expect(weeks[0]![0]).toMatchObject({ date: '2026-01-04' });
  });

  it('has no columns for an empty series', () => {
    expect(toWeeks([])).toEqual([]);
  });
});

describe('monthLabels', () => {
  it('labels each month once, above a column that starts inside it', () => {
    const weeks = toWeeks(series('2026-01-01', Array(70).fill(1)));
    const labels = monthLabels(weeks);
    expect(labels.filter(Boolean)).toEqual(['Jan', 'Feb', 'Mar']);
    // The label must sit on a week whose first cell is in the first 7 days of
    // that month — that is what keeps it above its own block.
    labels.forEach((label, i) => {
      if (!label) return;
      const first = weeks[i]!.find((c) => c !== null)!;
      expect(Number(first.date.slice(8, 10))).toBeLessThanOrEqual(7);
    });
  });
});

describe('thresholds and level', () => {
  it('ignores empty days, so a mostly-quiet year still has four steps', () => {
    const counts = [0, 0, 0, 0, 1, 2, 3, 4];
    const q = thresholds(counts);
    expect(level(0, q)).toBe(0);
    expect(level(1, q)).toBe(1);
    expect(level(4, q)).toBe(4);
  });

  it('is not flattened by one outlier day', () => {
    // 20 ordinary days plus a CI burst. On a linear scale every ordinary day
    // would collapse into the bottom bucket.
    const q = thresholds([...Array<number>(20).fill(10), 5000]);
    expect(level(10, q)).toBeLessThanOrEqual(3);
    expect(level(5000, q)).toBe(4);
    expect(q[0]).toBeLessThan(q[1]);
    expect(q[1]).toBeLessThan(q[2]);
  });

  it('never puts a day with calls in the empty bucket', () => {
    expect(level(1, thresholds([1]))).toBeGreaterThan(0);
  });
});

describe('streaks', () => {
  it('counts back from today', () => {
    expect(currentStreak(series('2026-01-01', [1, 0, 1, 1, 1]))).toBe(3);
  });

  it('does not end a streak on a today that has not happened yet', () => {
    // Trailing 0 is the current UTC day before the first call of the morning.
    expect(currentStreak(series('2026-01-01', [1, 1, 1, 0]))).toBe(3);
    // But two quiet days is a genuinely broken streak.
    expect(currentStreak(series('2026-01-01', [1, 1, 0, 0]))).toBe(0);
  });

  it('reports the best run anywhere in the window', () => {
    expect(longestStreak(series('2026-01-01', [1, 1, 1, 1, 0, 1, 1]))).toBe(4);
    expect(longestStreak(series('2026-01-01', [0, 0, 0]))).toBe(0);
  });
});
