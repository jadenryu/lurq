import { describe, it, expect } from 'vitest';
import { buildMermaid } from '../src/mcp/diagram';

describe('buildMermaid', () => {
  const mermaid = buildMermaid([
    { label: 'react', category: 'framework' },
    { label: 'tailwindcss', category: 'styling' },
    { label: 'zustand', category: 'state-management' },
    { label: 'express', category: 'framework' },
    { label: 'prisma', category: 'orm' },
  ]);

  it('produces a flowchart with layered subgraphs', () => {
    expect(mermaid.startsWith('flowchart TD')).toBe(true);
    expect(mermaid).toContain('subgraph Presentation');
    expect(mermaid).toContain('subgraph Data');
    expect(mermaid).toContain('db[(Database)]');
  });

  it('routes backend frameworks to the Backend layer, not Presentation', () => {
    const lines = mermaid.split('\n');
    const backendIdx = lines.findIndex((l) => l.includes('subgraph Backend'));
    const presIdx = lines.findIndex((l) => l.includes('subgraph Presentation'));
    expect(backendIdx).toBeGreaterThan(-1);
    // express should appear under Backend; react under Presentation.
    const expressLine = lines.findIndex((l) => l.includes('express'));
    const reactLine = lines.findIndex((l) => l.includes('"framework: react"'));
    expect(expressLine).toBeGreaterThan(backendIdx);
    expect(reactLine).toBeGreaterThan(presIdx);
    expect(reactLine).toBeLessThan(backendIdx);
  });

  it('connects from User down to the database', () => {
    expect(mermaid).toContain('user([User])');
    expect(mermaid).toMatch(/user --> n\d+_react/);
  });
});
