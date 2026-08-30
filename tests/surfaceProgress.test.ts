/**
 * The checkpoint arithmetic behind the "four ways in" section (apps/web).
 *
 * Every case here fails silently. Resolving one checkpoint off lights the wrong
 * row for a whole entry point and still renders perfectly; taking the *first*
 * block past the line instead of the last strands the rail one short at the
 * bottom of the page, where the remaining blocks are all on screen and there is
 * no scroll left to separate them. Looking at the page catches neither.
 *
 * `tops` are viewport-relative block offsets and `anchor` is the reading line,
 * so a block at a negative top has already scrolled above it.
 */
import { describe, expect, it } from 'vitest';
import { checkpointAt } from '../apps/web/src/lib/surface-progress';

/** Four blocks 600px apart, with the first `scrolled` px above the anchor. */
const at = (scrolled: number) => [0, 600, 1200, 1800].map((t) => t - scrolled);

const ANCHOR = 0;

describe('checkpointAt', () => {
  it('is empty and on the first stop before the section arrives', () => {
    // Every block still below the reading line.
    expect(checkpointAt(at(-200), ANCHOR)).toEqual({ index: 0, fill: 0 });
  });

  it('lands exactly on a stop as that block reaches the line', () => {
    // This is the property the whole interpolation exists for: the head must
    // touch the dot it is pointing at, on all four.
    expect(checkpointAt(at(0), ANCHOR)).toEqual({ index: 0, fill: 0 });
    expect(checkpointAt(at(600), ANCHOR)).toEqual({ index: 1, fill: 1 / 3 });
    expect(checkpointAt(at(1200), ANCHOR)).toEqual({ index: 2, fill: 2 / 3 });
    expect(checkpointAt(at(1800), ANCHOR)).toEqual({ index: 3, fill: 1 });
  });

  it('travels smoothly between two stops', () => {
    const mid = checkpointAt(at(300), ANCHOR);
    expect(mid.index).toBe(0);
    expect(mid.fill).toBeCloseTo(1 / 6, 10);
  });

  it('holds the last checkpoint once the section is behind you', () => {
    const past = checkpointAt(at(4000), ANCHOR);
    expect(past).toEqual({ index: 3, fill: 1 });
  });

  it('takes the LAST block past the line, not the first', () => {
    // The bottom of the page: nothing scrolls further, so blocks 2, 3 and 4 are
    // all above the anchor at once. Reading forward would pin the rail to the
    // first of them while the reader is plainly at the last.
    expect(checkpointAt([-900, -600, -300, -10], ANCHOR).index).toBe(3);
  });

  it('never returns a fill outside 0..1 or an index off the rail', () => {
    for (const scrolled of [-5000, -1, 0, 599, 601, 1799, 1801, 99999]) {
      const c = checkpointAt(at(scrolled), ANCHOR);
      expect(c.index).toBeGreaterThanOrEqual(0);
      expect(c.index).toBeLessThanOrEqual(3);
      expect(c.fill).toBeGreaterThanOrEqual(0);
      expect(c.fill).toBeLessThanOrEqual(1);
    }
  });

  it('survives a rail that has not been laid out yet', () => {
    // Every block at 0 before first paint: no span to interpolate across.
    expect(checkpointAt([0, 0, 0, 0], ANCHOR)).toEqual({ index: 3, fill: 1 });
    expect(checkpointAt([], ANCHOR)).toEqual({ index: 0, fill: 0 });
    expect(checkpointAt([120], ANCHOR)).toEqual({ index: 0, fill: 0 });
    expect(checkpointAt([-120], ANCHOR)).toEqual({ index: 0, fill: 1 });
  });

  it('reads the anchor as a real viewport line, not a constant', () => {
    // Same layout, lower reading line: the second block counts as reached.
    const tops = [-100, 300, 900, 1500];
    expect(checkpointAt(tops, 0).index).toBe(0);
    expect(checkpointAt(tops, 400).index).toBe(1);
    expect(checkpointAt(tops, 1000).index).toBe(2);
  });
});
