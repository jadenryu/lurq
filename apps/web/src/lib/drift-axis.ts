/**
 * The tick positions for the drift board's time axis.
 *
 * Its own module rather than a helper inside drift-board.tsx for one reason:
 * the header labels these and every lane in the table is ruled at them, so if
 * the thinning or the year rule is wrong the whole column is quietly lying
 * about which month a package broke in. That is worth a test, and a test wants
 * a function it can import without a React renderer.
 */
export type AxisTick = {
  /** Position along the lane, as a CSS percentage. */
  at: string;
  /** What the tick is called under the rule. */
  label: string;
};

/** The most a ~240px column can label without the words touching. */
const MAX_TICKS = 5;

/**
 * Every first-of-month strictly inside (t0, t1), thinned to at most five.
 *
 * The axis has to work over a span of three months and a span of nineteen, so
 * the ticks are derived rather than chosen. Both bounds are treated as UTC
 * instants, like every other date on this board: a cutoff of 2026-05-01 read in
 * a local zone west of Greenwich lands in April, and this is a section about
 * being a month behind.
 *
 * The year rides along only when it changes, which is how a printed axis does
 * it: "feb 25, jun, oct, feb 26, jun" reads as one run of time, where stamping
 * the year on all five reads as five separate labels.
 */
export function axisTicks(t0: number, t1: number): AxisTick[] {
  if (!(t1 > t0)) return [];

  const marks: number[] = [];
  const cursor = new Date(t0);
  cursor.setUTCDate(1);
  for (
    cursor.setUTCMonth(cursor.getUTCMonth() + 1);
    cursor.getTime() < t1;
    cursor.setUTCMonth(cursor.getUTCMonth() + 1)
  ) {
    marks.push(cursor.getTime());
  }

  const step = Math.ceil(marks.length / MAX_TICKS) || 1;
  let year = new Date(t0).getUTCFullYear();

  return marks
    .filter((_, i) => i % step === 0)
    .map((t) => {
      const on = new Date(t);
      const name = on
        .toLocaleDateString("en-GB", { month: "short", timeZone: "UTC" })
        .toLowerCase();
      const shown = on.getUTCFullYear();
      const label = shown === year ? name : `${name} ${String(shown).slice(2)}`;
      year = shown;
      return { at: `${(((t - t0) / (t1 - t0)) * 100).toFixed(2)}%`, label };
    });
}
