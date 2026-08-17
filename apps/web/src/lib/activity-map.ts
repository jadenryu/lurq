/**
 * Calendar arithmetic for the dashboard activity map (apps/web).
 *
 * Split from the component for the same reason `drift-axis` is: every one of
 * these is a silent-failure shape. A grid that pads the wrong number of leading
 * cells puts Tuesday's square on the Monday row for the whole year and still
 * renders perfectly; a month label placed on the wrong column misdates a
 * quarter. None of that throws, so none of it is caught by rendering the page
 * and looking at it.
 *
 * Dates are handled as 'YYYY-MM-DD' strings and only ever parsed as UTC —
 * the counters they come from are UTC days, and going through a local-time
 * `Date` would shift the whole grid by one for anyone west of Greenwich.
 */

export interface Point {
  date: string;
  count: number;
}

/** Boundaries between the four non-empty levels: below `q1` is level 1, and at
 *  or above `q3` is level 4. Half-open on purpose — with `<=`, the busiest day
 *  in a small window lands in level 3 and the darkest square never appears. */
export type Thresholds = [number, number, number];

/**
 * Buckets from the quartiles of *active* days, not from the maximum.
 *
 * One CI run firing three thousand calls in an afternoon would otherwise set the
 * top of a linear scale and flatten every ordinary working day into level 1 —
 * the map would say "you used lurq once", which is the opposite of true.
 */
export function thresholds(counts: number[]): Thresholds {
  const active = counts.filter((c) => c > 0).sort((a, b) => a - b);
  if (!active.length) return [1, 2, 3];
  const at = (q: number) => active[Math.min(active.length - 1, Math.floor(active.length * q))]!;
  const a = Math.max(1, at(0.25));
  const b = Math.max(a + 1, at(0.5));
  return [a, b, Math.max(b + 1, at(0.75))];
}

export function level(count: number, [q1, q2, q3]: Thresholds): 0 | 1 | 2 | 3 | 4 {
  if (count <= 0) return 0;
  if (count < q1) return 1;
  if (count < q2) return 2;
  if (count < q3) return 3;
  return 4;
}

/**
 * Consecutive days with at least one call, ending now.
 *
 * An empty *today* is skipped rather than treated as a break: the counter rolls
 * at UTC midnight, so someone opening this at 09:00 has not had their day yet.
 * Zeroing a real streak on that basis would be wrong far more often than right.
 */
export function currentStreak(series: Point[]): number {
  let i = series.length - 1;
  if (i >= 0 && series[i]!.count === 0) i -= 1;
  let streak = 0;
  for (; i >= 0 && series[i]!.count > 0; i -= 1) streak += 1;
  return streak;
}

export function longestStreak(series: Point[]): number {
  let best = 0;
  let run = 0;
  for (const p of series) {
    run = p.count > 0 ? run + 1 : 0;
    if (run > best) best = run;
  }
  return best;
}

/**
 * Weeks as columns, weekdays as rows.
 *
 * Leading nulls pad the first column so every column is a real Sunday→Saturday
 * week. Without that padding the rows stop meaning weekdays entirely, which is
 * the whole grammar of the chart.
 */
export function toWeeks(series: Point[]): (Point | null)[][] {
  if (!series.length) return [];
  const lead = new Date(`${series[0]!.date}T00:00:00Z`).getUTCDay();
  const cells: (Point | null)[] = [...Array<null>(lead).fill(null), ...series];
  const weeks: (Point | null)[][] = [];
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));
  return weeks;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/**
 * One label per month, on the first column that *starts* inside it.
 *
 * The `<= 7` guard is what keeps a label above its own block: a month whose 1st
 * falls mid-week first appears in a column belonging mostly to the previous
 * month, and labelling that column puts every month name one week to the left.
 */
export function monthLabels(weeks: (Point | null)[][]): (string | null)[] {
  let last = -1;
  return weeks.map((week) => {
    const first = week.find((c): c is Point => c !== null);
    if (!first) return null;
    const month = Number(first.date.slice(5, 7)) - 1;
    if (month !== last && Number(first.date.slice(8, 10)) <= 7) {
      last = month;
      return MONTHS[month]!;
    }
    return null;
  });
}
