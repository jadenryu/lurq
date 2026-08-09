import { describe, it, expect } from 'vitest';
import { buildMermaid, handleDiagram } from '../src/mcp/diagram';
import { classifyRuntimeTarget } from '../src/core/runtimeTarget';
import type { Database } from '../src/db/client';

describe('buildMermaid', () => {
  // runtimeTarget is what handleDiagram reads off the packages row; a
  // `framework` without it stays in Presentation, which is the safe default.
  const mermaid = buildMermaid([
    { label: 'react', category: 'framework', runtimeTarget: 'browser' },
    { label: 'tailwindcss', category: 'styling' },
    { label: 'zustand', category: 'state-management' },
    { label: 'express', category: 'framework', runtimeTarget: 'node' },
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

  it('places a backend framework lurq has never heard of', () => {
    // The point of replacing the six-name list: a framework published tomorrow
    // classifies from its own manifest, with nobody editing lurq.
    expect(
      classifyRuntimeTarget({
        name: 'brand-new-server-framework',
        hasBrowserField: false,
        keywords: ['http-server', 'middleware', 'rest'],
        engines: { node: '>=20' },
        peerDependencies: null,
      }),
    ).toBe('node');
  });

  it('does not mistake a UI library for a server because it says `api`', () => {
    expect(
      classifyRuntimeTarget({
        name: 'some-component-kit',
        hasBrowserField: false,
        keywords: ['api', 'components', 'ui'],
        engines: null,
        peerDependencies: { react: '^19' },
      }),
    ).toBe('browser');
  });

  it('refuses to guess when the manifest says nothing useful', () => {
    expect(
      classifyRuntimeTarget({
        name: 'inscrutable',
        hasBrowserField: false,
        keywords: [],
        engines: null,
        peerDependencies: null,
      }),
    ).toBeNull();
  });

  it('connects from User down to the database', () => {
    expect(mermaid).toContain('user([User])');
    expect(mermaid).toMatch(/user --> n\d+_react/);
  });
});

describe('buildMermaid unclassified bucket', () => {
  const mermaid = buildMermaid([
    { label: 'react', category: 'framework' },
    { label: 'mystery-pkg', category: null },
  ]);

  it('places an unclassifiable package in an explicit Unclassified subgraph', () => {
    expect(mermaid).toContain('subgraph Unclassified');
    expect(mermaid).toContain('"mystery-pkg"'); // no faked "category: " prefix
  });

  it('does not wire Unclassified into the user→db flow', () => {
    const flowEdges = mermaid.split('\n').filter((l) => l.includes('-->'));
    expect(flowEdges.some((l) => l.includes('mystery-pkg'))).toBe(false);
  });
});

describe('handleDiagram empty input', () => {
  // The empty-stack branch returns before any DB access, so a stub db is safe.
  const stubDb = {} as Database;

  it('returns a clear note when no stack is provided', async () => {
    const result = await handleDiagram(stubDb, {});
    expect(result.note).toMatch(/stack/i);
    expect(result.mermaid).toContain('flowchart TD');
  });

  it('returns the same note for an empty stack array', async () => {
    const result = await handleDiagram(stubDb, { stack: [] });
    expect(result.note).toMatch(/does not infer an architecture/i);
  });
});

describe('handleDiagram classification annotation', () => {
  // Stub db: no package is "known", so classification falls to inferCategory.
  const stubDb = {
    select: () => ({ from: () => ({ where: () => [] }) }),
  } as unknown as Database;

  it('annotates packages it could not place instead of faking a layer', async () => {
    const result = await handleDiagram(stubDb, { stack: ['react', 'zzqqx-unknown'] });
    expect(result.note).toMatch(/partial, not authoritative/i);
    expect(result.note).toContain('zzqqx-unknown');
    expect(result.note).not.toContain('react'); // react matches a category, gets placed
    expect(result.mermaid).toContain('subgraph Unclassified');
  });

  it('uses the clean note when every package places cleanly', async () => {
    const result = await handleDiagram(stubDb, { stack: ['react'] });
    expect(result.note).not.toMatch(/could not place/i);
    expect(result.mermaid).not.toContain('subgraph Unclassified');
  });
});
