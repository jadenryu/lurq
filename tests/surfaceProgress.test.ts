/**
 * The scroll arithmetic behind the "four ways in" section (apps/web).
 *
 * Every function here fails silently. A step boundary off by one lights the
 * wrong row for a quarter of the section and still renders perfectly; p = 1
 * landing one past the end blanks the panel on the last frame a reader sees;
 * a fill divided by the wrong denominator leaves the bar short on the last row
 * and implies a fifth step. Scrolling the page does not catch any of them.
 */
import { describe, expect, it } from 'vitest';
import {
  fillFor,
  progress,
  stepAt,
  travelFor,
} from '../apps/web/src/lib/surface-progress';

const STEPS = 4;

describe('progress', () => {
  it('is the fraction of the span travelled', () => {
    expect(progress(0, 1000)).toBe(0);
    expect(progress(250, 1000)).toBe(0.25);
    expect(progress(1000, 1000)).toBe(1);
  });

  it('clamps outside the hold rather than running past it', () => {
    // Above the section, and after the track has let go.
    expect(progress(-400, 1000)).toBe(0);
    expect(progress(1400, 1000)).toBe(1);
  });

  it('reads a missing track as "not started", never NaN', () => {
    // The stylesheet drops the track under reduce / narrow / short. Dividing
    // would put NaN into a custom property, and a NaN fill paints nothing.
    expect(progress(0, 0)).toBe(0);
    expect(progress(120, 0)).toBe(0);
    expect(Number.isNaN(progress(120, 0))).toBe(false);
  });
});

describe('stepAt', () => {
  it('gives each step an equal, half-open band', () => {
    expect(stepAt(0, STEPS)).toBe(0);
    expect(stepAt(0.24, STEPS)).toBe(0);
    expect(stepAt(0.25, STEPS)).toBe(1);
    expect(stepAt(0.5, STEPS)).toBe(2);
    expect(stepAt(0.75, STEPS)).toBe(3);
    expect(stepAt(0.99, STEPS)).toBe(3);
  });

  it('holds the last step at exactly 1 instead of running one past the end', () => {
    // floor(1 * 4) is 4, which is not a step. This is the frame the track runs
    // out, i.e. the last thing anyone sees of the section.
    expect(stepAt(1, STEPS)).toBe(STEPS - 1);
  });

  it('clamps a progress that was never in range', () => {
    expect(stepAt(-1, STEPS)).toBe(0);
    expect(stepAt(2, STEPS)).toBe(STEPS - 1);
  });
});

describe('travelFor', () => {
  it('targets the middle of a step’s band, never its edge', () => {
    // A click landing on the boundary is one pixel from the previous step.
    expect(travelFor(0, STEPS, 1000)).toBe(125);
    expect(travelFor(3, STEPS, 1000)).toBe(875);
  });

  it('round-trips: every target lands back on the step that asked for it', () => {
    for (let i = 0; i < STEPS; i += 1) {
      expect(stepAt(progress(travelFor(i, STEPS, 1900), 1900), STEPS)).toBe(i);
    }
  });

  it('stays inside the track for an out-of-range step', () => {
    expect(travelFor(-2, STEPS, 1000)).toBe(125);
    expect(travelFor(9, STEPS, 1000)).toBe(875);
  });
});

describe('fillFor', () => {
  it('runs the bar from empty on the first step to full on the last', () => {
    // Dividing by STEPS instead would stop at 0.75 and imply a fifth step.
    expect(fillFor(0, STEPS)).toBe(0);
    expect(fillFor(3, STEPS)).toBe(1);
  });

  it('spaces the middle steps evenly', () => {
    expect(fillFor(1, STEPS)).toBeCloseTo(1 / 3, 10);
    expect(fillFor(2, STEPS)).toBeCloseTo(2 / 3, 10);
  });

  it('does not divide by zero on a single-step rail', () => {
    expect(fillFor(0, 1)).toBe(1);
  });
});
