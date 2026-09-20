/**
 * Upkeep axes that are not dependency currency.
 *
 * Two properties matter more than the numbers here. An axis must never turn "we
 * could not look" into a zero — that is the difference between telling someone
 * their repo has no automation and admitting we did not read it. And the
 * automation axis must score lurq's own workflow exactly as it scores
 * Dependabot, because a report people share is worth nothing the moment its
 * scoring favours the vendor who wrote it.
 */
import { describe, expect, it } from 'vitest';
import {
  AUTOMATION_PATHS,
  SUPPORTED_NODE_FLOOR,
  automationAxis,
  runtimeAxis,
  type UpkeepProbe,
} from '../src/github/upkeepAxes';

const probe = (path: string, present: boolean | null): UpkeepProbe => ({ path, present });
const allUnread = () => AUTOMATION_PATHS.map((p) => probe(p, null));
const allAbsent = () => AUTOMATION_PATHS.map((p) => probe(p, false));

describe('runtimeAxis', () => {
  it('scores a current declared floor', () => {
    const axis = runtimeAxis({ engines: { node: `>=${SUPPORTED_NODE_FLOOR}` } });
    expect(axis.score).toBe(100);
    expect(axis.evidence.join(' ')).toContain(`Node ${SUPPORTED_NODE_FLOOR}`);
  });

  it('reads a caret range by the version it actually admits', () => {
    // `^22.1.0` admits 22.1.0 upward, so the floor is 22 — not the 22.1.0
    // string, and not "whatever the latest 22 is".
    expect(runtimeAxis({ engines: { node: '^22.1.0' } }).score).toBe(100);
  });

  it('marks a stale floor without calling it absent', () => {
    const axis = runtimeAxis({ engines: { node: '>=18' } });
    // Halfway: declaring an old runtime is meaningfully better than declaring
    // none, and collapsing the two would make the axis useless for the repos
    // most likely to act on it.
    expect(axis.score).toBe(50);
    expect(axis.evidence.join(' ')).toContain('below the Node');
  });

  it('scores a missing declaration zero, because that is a finding', () => {
    expect(runtimeAxis({ name: 'x' }).score).toBe(0);
    expect(runtimeAxis({ engines: {} }).score).toBe(0);
    expect(runtimeAxis({ name: 'x' }).evidence.join(' ')).toContain('engines.node');
  });

  it('refuses to guess at an unusable range', () => {
    const axis = runtimeAxis({ engines: { node: 'lts/*' } });
    expect(axis.score).toBe(0);
    expect(axis.evidence.join(' ')).toContain('not a usable range');
  });

  it('returns null when there was no manifest to read at all', () => {
    // The distinction the whole file turns on: unmeasured is not zero.
    expect(runtimeAxis(null).score).toBeNull();
    expect(runtimeAxis(undefined).score).toBeNull();
    expect(runtimeAxis('not an object').score).toBeNull();
  });
});

describe('automationAxis', () => {
  it('reports null when no config path could be read', () => {
    // Zero here would tell someone their repo has no automation on the strength
    // of a rate limit.
    const axis = automationAxis(allUnread());
    expect(axis.score).toBeNull();
    // The all-unread message, verbatim. The "N path(s) could not be read"
    // wording belongs to a PARTIAL read, which is a different claim: some
    // evidence versus none.
    expect(axis.evidence.join(' ')).toContain('none of the automation config paths could be read');
  });

  it('reports zero when every path answered and none was there', () => {
    const axis = automationAxis(allAbsent());
    expect(axis.score).toBe(0);
    expect(axis.evidence.join(' ')).toContain('nothing configured');
  });

  it('names the robot it found', () => {
    const axis = automationAxis([probe('.github/dependabot.yml', true), ...allAbsent().slice(1)]);
    expect(axis.score).toBe(100);
    expect(axis.evidence.join(' ')).toContain('Dependabot');
  });

  it('scores lurq exactly as it scores Dependabot', () => {
    // The anti-marketing invariant. If these two ever diverge, the report is
    // grading people on whether they bought our product.
    const dependabot = automationAxis([probe('.github/dependabot.yml', true)]);
    const lurq = automationAxis([probe('.github/workflows/lurq-upgrade.yml', true)]);
    const renovate = automationAxis([probe('renovate.json', true)]);
    expect(lurq.score).toBe(dependabot.score);
    expect(renovate.score).toBe(dependabot.score);
    expect(lurq.evidence.join(' ')).toContain('lurq autopilot');
  });

  it('still says what it missed when a partial read found something', () => {
    const axis = automationAxis([
      probe('.github/dependabot.yml', true),
      probe('renovate.json', null),
      probe('.renovaterc.json', null),
    ]);
    expect(axis.score).toBe(100);
    expect(axis.evidence.join(' ')).toContain('2 config path(s) could not be read');
  });

  it('qualifies a zero reached from an incomplete read', () => {
    // Every answered path said no, but one never answered. The score is still
    // zero — some evidence beats none — and the caveat travels with it.
    const axis = automationAxis([
      probe('.github/dependabot.yml', false),
      probe('renovate.json', null),
    ]);
    expect(axis.score).toBe(0);
    expect(axis.evidence.join(' ')).toContain('1 config path(s) could not be read');
  });

  it('handles being handed nothing', () => {
    expect(automationAxis([]).score).toBeNull();
  });
});

describe('AUTOMATION_PATHS', () => {
  it('covers the robots that actually keep dependencies current', () => {
    const joined = AUTOMATION_PATHS.join(' ');
    expect(joined).toContain('dependabot');
    expect(joined).toContain('renovate');
    expect(joined).toContain('lurq-upgrade');
  });

  it('probes only known paths, never a directory listing', () => {
    // A listing is a REST call, and the anonymous budget this scan runs on is
    // 60/hour server-wide. Every entry here has to be a literal file path.
    for (const path of AUTOMATION_PATHS) {
      expect(path).toMatch(/\.(yml|yaml|json)$/);
      expect(path).not.toContain('*');
    }
  });
});
