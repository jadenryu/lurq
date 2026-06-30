import { describe, it, expect } from 'vitest';
import { decomposeHeuristic, familyOf, flagSlotConflicts, orderCandidates } from '../src/mcp/plan';
import type { Candidate, CompatConflict } from '../src/core/types';

describe('flagSlotConflicts', () => {
  const picks = [
    { need: 'ui', name: 'react' },
    { need: 'render', name: 'react-dom' },
    { need: 'state', name: 'zustand' },
  ];

  it('maps each involved slot to the packages it conflicts with', () => {
    const conflicts: CompatConflict[] = [
      { source: 'peer-deps', packages: ['react-dom', 'react'], detail: 'x' },
    ];
    const flags = flagSlotConflicts(picks, conflicts);
    expect(flags.get('render')).toEqual(['react']);
    expect(flags.get('ui')).toEqual(['react-dom']);
    expect(flags.get('state')).toBeUndefined();
  });

  it('returns an empty map when there are no conflicts', () => {
    expect(flagSlotConflicts(picks, []).size).toBe(0);
  });
});

const cand = (name: string): Candidate => ({
  name,
  category: 'routing',
  healthScore: 80,
  qualityScore: 70,
  confidence: 'proven',
  why: '',
  latestVersion: '1',
  weeklyDownloads: 1,
  lastReleaseAt: null,
  repoUrl: null,
});

describe('decomposeHeuristic', () => {
  it('extracts one need per distinct inferable category from a spec', () => {
    const doc = [
      '# MyApp',
      '## Stack',
      '- Built on a React framework',
      '- Needs client-side routing between views',
      '- Form handling for user input',
      '- Schema validation at the API boundary',
      '- An ORM for the database layer',
      '- Make API calls to a payments service (http client)',
    ].join('\n');
    const needs = decomposeHeuristic(doc);
    const categories = needs.map((n) => n.category);
    expect(categories).toContain('framework');
    expect(categories).toContain('routing');
    expect(categories).toContain('validation');
    expect(categories).toContain('orm');
    expect(categories).toContain('http-client');
  });

  it('dedupes a category to a single need (first matching line)', () => {
    const doc = ['routing is needed', 'more routing notes here', 'and yet more routing'].join('\n');
    const routing = decomposeHeuristic(doc).filter((n) => n.category === 'routing');
    expect(routing).toHaveLength(1);
    expect(routing[0]!.need).toBe('routing is needed');
  });

  it('strips markdown bullets/headings from the need phrase', () => {
    const needs = decomposeHeuristic('### - state management with a global store');
    expect(needs[0]!.need).toBe('state management with a global store');
    expect(needs[0]!.category).toBe('state-management');
  });

  it('returns nothing for prose with no recognizable component', () => {
    expect(decomposeHeuristic('This document is about our company mission and values.')).toEqual([]);
  });
});

describe('familyOf', () => {
  it('classifies packages by framework family, null for agnostic', () => {
    expect(familyOf('react-router')).toBe('react');
    expect(familyOf('@tanstack/react-router')).toBe('react');
    expect(familyOf('preact')).toBe('react');
    expect(familyOf('vue-router')).toBe('vue');
    expect(familyOf('@angular/router')).toBe('angular');
    expect(familyOf('svelte-routing')).toBe('svelte');
    expect(familyOf('axios')).toBeNull();
    expect(familyOf('zustand')).toBeNull();
  });
});

describe('orderCandidates (cross-slot coherence)', () => {
  const m = new Map<string, number>();

  it('demotes a competing framework and promotes the anchor ecosystem', () => {
    const out = orderCandidates([cand('vue-router'), cand('react-router'), cand('axios')], 'react', 'balanced', m);
    expect(out.map((c) => c.name)).toEqual(['react-router', 'axios', 'vue-router']);
  });

  it('is a no-op (preserves relevance order) when no framework is anchored', () => {
    const out = orderCandidates([cand('vue-router'), cand('react-router')], null, 'balanced', m);
    expect(out.map((c) => c.name)).toEqual(['vue-router', 'react-router']);
  });

  it('breaks ties by lightest bundle under optimize=speed', () => {
    const bundles = new Map([['react-router', 20], ['@tanstack/react-router', 5]]);
    const out = orderCandidates(
      [cand('react-router'), cand('@tanstack/react-router')],
      'react',
      'speed',
      bundles,
    );
    expect(out[0]!.name).toBe('@tanstack/react-router');
  });
});
