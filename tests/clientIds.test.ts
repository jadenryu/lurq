import { describe, expect, it } from 'vitest';
import { CLIENT_PROFILES } from '../src/clients/profiles';
import { CLIENT_IDS } from '../src/clients/types';

/**
 * The tool's input schema validates `client` against CLIENT_IDS without loading
 * the profiles. If the two lists drift, a valid client is refused or a profile is
 * unreachable, and neither fails loudly on its own.
 */
describe('CLIENT_IDS', () => {
  it('names exactly the clients that have a profile, once each', () => {
    expect([...CLIENT_IDS].sort()).toEqual(CLIENT_PROFILES.map((c) => c.id).sort());
    expect(new Set(CLIENT_IDS).size).toBe(CLIENT_IDS.length);
  });

  it('gives every profile at least one source and a verification date', () => {
    for (const c of CLIENT_PROFILES) {
      expect(c.sources.length, c.id).toBeGreaterThan(0);
      expect(c.verifiedAt, c.id).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  });
});
