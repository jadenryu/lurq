import { describe, it, expect, afterEach } from 'vitest';
import {
  firstTouchSurface,
  firstTouchPair,
  resetSurfaceFirstTouch,
  SURFACE_FIRST_TOUCH_BUDGET_MS,
} from '../src/pipeline/firstTouch';

const db = {} as never; // never reached: every case below short-circuits first.

afterEach(() => resetSurfaceFirstTouch());

describe('surface first-touch', () => {
  // The whole point of relaxing "never extract inside a query" is that the
  // relaxation is BOUNDED. A budget of zero must not start work at all — that
  // is what lets a caller opt back into the old enqueue-and-answer behaviour.
  it('does no work when the budget is zero or negative', async () => {
    await expect(firstTouchSurface(db, 'zod', '3.0.0', 0)).resolves.toBeNull();
    await expect(firstTouchSurface(db, 'zod', '3.0.0', -1)).resolves.toBeNull();
    await expect(firstTouchPair(db, 'zod', '3.0.0', '4.0.0', 0)).resolves.toBe(false);
  });

  it('has a budget large enough for the two extractions a diff needs', () => {
    // A diff races both halves under ONE budget. At the measured ~0.52s per
    // extraction this leaves real headroom; if someone lowers it below a single
    // extraction, diff_surface silently returns to always answering unknown.
    expect(SURFACE_FIRST_TOUCH_BUDGET_MS).toBeGreaterThanOrEqual(2000);
  });

  it('a pair needs BOTH halves, never one', async () => {
    // A diff with one side missing is the empty-surface comparison the diff
    // guards already refuse — reporting it as success would turn "we could not
    // measure" into "everything was removed".
    await expect(firstTouchPair(db, 'pkg', 'a', 'b', 0)).resolves.toBe(false);
  });
});
