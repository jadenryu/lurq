/**
 * `planHeadline` — the line shown to someone who did not ask for a report.
 *
 * It goes in front of a user once, at setup, and in front of an agent at every
 * session start, so the two failure modes both cost more than a wrong number in
 * a report they opened deliberately: understating the repo wastes the one
 * moment, and overstating it is the overclaim the gate never recovers from.
 */
import { describe, it, expect } from 'vitest';
import { planHeadline, type UpgradePlanResult } from '../src/cli/upgradePlan';

const plan = (over: Partial<UpgradePlanResult> = {}): UpgradePlanResult => ({
  upgrades: [],
  omitted: 0,
  pending: 0,
  untracked: 0,
  manifests: 1,
  deps: 60,
  ...over,
});

const upgrade = (over: Partial<UpgradePlanResult['upgrades'][number]> = {}) =>
  ({
    package: 'pkg',
    fromVersion: '1.0.0',
    toVersion: '2.0.0',
    declaredIn: [],
    hops: [],
    majorsBehind: 1,
    advisories: 0,
    deprecated: false,
    verdict: 'clean' as const,
    removed: [],
    arityChanged: [],
    typeOnlyRemoved: [],
    newlyDeprecated: [],
    ...over,
  }) as UpgradePlanResult['upgrades'][number];

describe('planHeadline', () => {
  it('says nothing about a project that is current', () => {
    expect(planHeadline(plan())).toBeNull();
  });

  it('counts drifted deps against the total', () => {
    expect(planHeadline(plan({ upgrades: [upgrade(), upgrade()] }))).toBe(
      '2 of 60 dependencies behind.',
    );
  });

  it('counts deps past the brief cap, which are drifted but unbriefed', () => {
    // The cap is why this matters: on the largest repos, most of the drift is
    // in `omitted`, and counting only `upgrades` would understate them most.
    const line = planHeadline(plan({ upgrades: [upgrade()], omitted: 30 }));
    expect(line).toContain('31 of 60 dependencies behind');
    expect(line).toContain('30 not assessed for breakage');
  });

  it('leads with advisories and export removals when there are any', () => {
    expect(
      planHeadline(
        plan({
          upgrades: [
            upgrade({ advisories: 2, verdict: 'removes-exports', removed: ['parse'] }),
            upgrade({ verdict: 'removes-exports', removed: ['x'] }),
            upgrade(),
          ],
        }),
      ),
    ).toBe('3 of 60 dependencies behind, 1 with a security advisory, 2 removing public exports.');
  });

  it('never lets an unmeasured dependency read as a clean one', () => {
    expect(planHeadline(plan({ upgrades: [upgrade()], pending: 3, untracked: 4 }))).toContain(
      '7 not assessed for breakage',
    );
  });
});
