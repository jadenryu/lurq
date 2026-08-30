/**
 * Scroll arithmetic for the "four ways in" section (surface-switch.tsx).
 *
 * Split out for the same reason `activity-map` and `drift-axis` are: every one
 * of these is a silent-failure shape. A step boundary that is off by one lights
 * the wrong row for a quarter of the section and still renders perfectly; a fill
 * that does not account for the track's inset leaves the head dot floating past
 * the last stop. Nothing throws, so nothing here is caught by scrolling the page
 * and looking at it.
 *
 * All of it is pure and unit-free: `travel` and `span` are both distances in the
 * same space (pixels down the pinned track), so nothing here needs to know where
 * the block sticks or how tall the viewport is.
 */

/** Clamp to the unit interval. */
function unit(n: number): number {
  return n < 0 ? 0 : n > 1 ? 1 : n;
}

/**
 * How far through the hold, 0..1.
 *
 * A span of zero means the stylesheet has taken the track away (reduce, narrow,
 * short, or scripting off) and there is no scroll to read. Returning 0 rather
 * than dividing is the difference between "the section has not started" and
 * `NaN` propagating into a CSS custom property, which paints nothing at all.
 */
export function progress(travel: number, span: number): number {
  if (!(span > 0)) return 0;
  return unit(travel / span);
}

/**
 * Which step a progress fraction lands on.
 *
 * `floor(p * steps)` is the whole rule, except at exactly p = 1, where it gives
 * `steps` — one past the end. That is the frame the track runs out, i.e. the
 * last thing a reader sees of this section, so getting it wrong would blank the
 * panel precisely as they scroll out of it.
 */
export function stepAt(p: number, steps: number): number {
  if (steps < 1) return 0;
  const i = Math.floor(unit(p) * steps);
  return i < 0 ? 0 : i > steps - 1 ? steps - 1 : i;
}

/**
 * How far down the track a click on `step` should land.
 *
 * The middle of the step's band, not its edge: targeting the boundary puts the
 * reader one pixel from the step before, so a click that overshoots by a hair
 * selects the wrong row and a click that undershoots does nothing visible.
 */
export function travelFor(step: number, steps: number, span: number): number {
  if (steps < 1) return 0;
  const i = step < 0 ? 0 : step > steps - 1 ? steps - 1 : step;
  return ((i + 0.5) / steps) * span;
}

/**
 * The bar's fill when the scroll is *not* driving it.
 *
 * Then it is not reporting a position in a hold, it is reporting which of the
 * four you picked, so it has to land on that step's own stop: the first step
 * reads empty and the last reads full. Dividing by `steps` instead would leave
 * the bar a quarter short on the last row, which reads as a section with a fifth
 * step you cannot reach.
 */
export function fillFor(active: number, steps: number): number {
  if (steps < 2) return 1;
  const i = active < 0 ? 0 : active > steps - 1 ? steps - 1 : active;
  return i / (steps - 1);
}
