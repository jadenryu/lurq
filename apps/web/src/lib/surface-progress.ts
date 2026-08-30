/**
 * Checkpoint arithmetic for the "four ways in" section (surface-switch.tsx).
 *
 * Split out for the same reason `activity-map` and `drift-axis` are: every one
 * of these is a silent-failure shape. A checkpoint that resolves one off lights
 * the wrong row for a whole entry point and still renders perfectly; a fill
 * divided by the wrong denominator leaves the bar short of the last stop and
 * implies a fifth section nobody can reach. Nothing throws, so nothing here is
 * caught by scrolling the page and looking at it.
 *
 * All of it is pure. `tops` are viewport-relative offsets and `anchor` is a
 * viewport line, so the whole model is "which block has crossed the line, and
 * how far to the next one" — no scroll position, no document height, and
 * nothing that has to know where the page starts.
 */

/** Clamp to the unit interval. */
function unit(n: number): number {
  return n < 0 ? 0 : n > 1 ? 1 : n;
}

export interface Checkpoint {
  /** Which entry point is the one being read. */
  index: number;
  /** How far down the rail the bar has filled, 0..1. */
  fill: number;
}

/**
 * Which checkpoint the reader is at, and where the bar should sit.
 *
 * The bar lands *exactly* on stop `i` at the moment block `i` crosses the
 * anchor, and travels smoothly to the next one in between. That is the whole
 * reason the fill is interpolated between block tops rather than taken from a
 * scroll fraction: a bar driven by raw scroll drifts off its own stops, and a
 * progress bar whose head does not touch the dot it is pointing at is worse
 * than no bar.
 *
 * Reading downward — the *last* block to have crossed the line wins — is what
 * makes this behave at the bottom of the page. The final blocks may all be on
 * screen at once with no scroll left to separate them, and taking the first
 * match would pin the rail to block 3 while the reader is plainly at block 4.
 */
export function checkpointAt(tops: number[], anchor: number): Checkpoint {
  const n = tops.length;
  if (n === 0) return { index: 0, fill: 0 };
  if (n === 1) return { index: 0, fill: tops[0]! <= anchor ? 1 : 0 };

  let at = -1;
  for (let i = 0; i < n; i += 1) {
    if (tops[i]! <= anchor) at = i;
  }

  // Above the first block: the section has not started, so nothing is lit and
  // the bar is empty. Not index -1, which would index off the front of the rail.
  if (at < 0) return { index: 0, fill: 0 };
  // Past the last: hold it full rather than letting it run on.
  if (at >= n - 1) return { index: n - 1, fill: 1 };

  const span = tops[at + 1]! - tops[at]!;
  // Two blocks at the same offset cannot be interpolated between. Only reachable
  // if the blocks have not been laid out yet, where 0 is the honest answer.
  const frac = span > 0 ? unit((anchor - tops[at]!) / span) : 0;
  return { index: at, fill: (at + frac) / (n - 1) };
}
