import { describe, it, expect } from 'vitest';
import { CAPABILITIES, searchCapabilities } from '../src/core/capabilities';

const top = (q: string) => searchCapabilities(q, 3).map((c) => c.id);

describe('searchCapabilities', () => {
  it('routes a question to the capability that answers it', () => {
    expect(top('will this upgrade break my code')).toContain('check-upgrade');
    expect(top('is this package name hallucinated')).toContain('verify');
    expect(top('stop agents installing GPL licensed things')).toContain('policy');
    expect(top('am I about to publish a breaking change')).toContain('check-release');
    expect(top('do these work together')).toContain('compat');
  });

  it('matches on a word only the aliases carry', () => {
    expect(top('dependabot')).toContain('autopilot');
    expect(top('typosquat')).toContain('verify');
  });

  it('finds a stem the query inflected', () => {
    expect(top('upgrading dependencies')).toEqual(expect.arrayContaining(['upgrade-plan']));
  });

  it('returns the menu rather than nothing for an empty or unmatched query', () => {
    expect(searchCapabilities('')).toHaveLength(5);
    expect(searchCapabilities('xyzzy qwertyuiop').length).toBeGreaterThan(0);
  });

  it('gives every entry a next move, since a match with no action is just prose', () => {
    for (const c of CAPABILITIES) {
      expect(c.mcp ?? c.cli ?? c.page, `${c.id} has no surface`).toBeTruthy();
    }
  });
});
