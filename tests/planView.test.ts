import { describe, it, expect } from 'vitest';
import { renderPlanHtml } from '../src/cli/planView';
import type { PlanOutput } from '../src/mcp/plan';

// Minimal PlanOutput — renderPlanHtml only reads these fields. Cast keeps the
// fixture small without reconstructing the full Candidate/compat shape.
function plan(overrides: Partial<PlanOutput> = {}): PlanOutput {
  return {
    dataAsOf: '2026-07-02T00:00:00.000Z',
    optimize: 'balanced',
    source: 'heuristic',
    framework: null,
    unmatched: [],
    mermaid: 'graph TD; a-->b;',
    note: 'a plan',
    slots: [
      {
        need: 'state management',
        category: 'state' as never,
        layer: 'State',
        recommended: { name: 'zustand', repoUrl: 'https://github.com/pmndrs/zustand', healthScore: 88, confidence: 'proven' } as never,
        alternatives: [{ name: 'jotai' } as never],
      },
    ],
    ...overrides,
  } as PlanOutput;
}

describe('renderPlanHtml', () => {
  it('renders the recommended package and its health score', () => {
    const html = renderPlanHtml(plan());
    expect(html).toContain('zustand');
    expect(html).toContain('88');
    expect(html).toContain('jotai');
  });

  it('shows a "no match" cell when a slot has no recommendation', () => {
    const html = renderPlanHtml(
      plan({
        slots: [
          { need: 'obscure thing', category: null, layer: 'Other', recommended: null, alternatives: [] } as never,
        ],
      }),
    );
    expect(html).toContain('no match');
  });

  it('escapes HTML in untrusted package names and URLs (XSS guard)', () => {
    const html = renderPlanHtml(
      plan({
        note: '<script>alert(1)</script>',
        slots: [
          {
            need: 'x',
            category: null,
            layer: 'L',
            recommended: {
              name: '<img src=x onerror=alert(1)>',
              repoUrl: 'https://e.vil/"><script>bad()</script>',
              healthScore: 1,
              confidence: 'unproven',
            } as never,
            alternatives: [],
          } as never,
        ],
      }),
    );
    // The raw injection must never appear unescaped.
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).not.toContain('<img src=x onerror=alert(1)>');
    // It should be present in escaped form instead.
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
  });
});
