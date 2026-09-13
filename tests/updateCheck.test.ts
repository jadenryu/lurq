import { describe, expect, it } from 'vitest';
import { planUpdateCheck } from '../src/cli/updateCheck';

const DAY = 24 * 60 * 60 * 1000;

describe('planUpdateCheck', () => {
  it('checks on the first run and says nothing yet', () => {
    expect(planUpdateCheck(null, Date.now(), '0.1.6')).toEqual({ message: null, refresh: true });
  });

  it('announces a newer published version, and waits a day before checking again', () => {
    const now = Date.now();
    const plan = planUpdateCheck({ checkedAt: now - 1000, latest: '0.2.0' }, now, '0.1.6');
    expect(plan.message).toContain('0.1.6 → 0.2.0');
    expect(plan.refresh).toBe(false);
  });

  it('is quiet when current or ahead, and re-checks once the day is up', () => {
    const now = Date.now();
    expect(planUpdateCheck({ checkedAt: now, latest: '0.1.6' }, now, '0.1.6').message).toBeNull();
    expect(planUpdateCheck({ checkedAt: now, latest: 'garbage' }, now, '0.1.6').message).toBeNull();
    expect(planUpdateCheck({ checkedAt: now - DAY - 1 }, now, '0.1.6').refresh).toBe(true);
  });
});
