import { describe, it, expect } from 'vitest';
import { loadSeedFile } from '../src/db/seed';
import { CATEGORIES } from '../src/core/types';

describe('seed list', () => {
  const seed = loadSeedFile();

  it('ships a useful number of packages (§16: ~150-300)', () => {
    expect(seed.length).toBeGreaterThanOrEqual(150);
    expect(seed.length).toBeLessThanOrEqual(300);
  });

  it('every entry has a valid category from the taxonomy', () => {
    for (const entry of seed) {
      expect(entry.category, entry.name).toBeDefined();
      expect(CATEGORIES, entry.name).toContain(entry.category);
    }
  });

  it('has no duplicate package names', () => {
    const names = seed.map((e) => e.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it('covers every category in the taxonomy (except `other`)', () => {
    const covered = new Set(seed.map((e) => e.category));
    for (const category of CATEGORIES) {
      if (category === 'other') continue;
      expect(covered, `missing category: ${category}`).toContain(category);
    }
  });

  it('includes the utility tier for the anti-reinvention use case', () => {
    const names = new Set(seed.map((e) => e.name));
    for (const util of ['debounce', 'slugify', 'uuid', 'p-retry', 'lodash']) {
      expect(names, util).toContain(util);
    }
  });
});
