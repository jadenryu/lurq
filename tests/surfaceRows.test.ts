import { describe, it, expect } from 'vitest';
import { UNBOUNDED_ARITY, type SymbolRow } from '../src/db/schema';
import { rowsToSurface } from '../src/mcp/surfaceHandlers';
import { diffSurfaces } from '../src/surface/diff';

let id = 0;
const row = (over: Partial<SymbolRow>): SymbolRow => ({
  id: ++id,
  entityId: 1,
  path: 'x',
  kind: 'function',
  arity: 1,
  origin: 'local',
  deprecated: false,
  tier: 'shipped_js_ast',
  signature: null,
  sourceFile: 'dist/index.js',
  sourceLine: 1,
  sourceOffset: null,
  maxArity: null,
  ...over,
});

// The dashboard, the brief, and diff_surface all diff STORED rows. Whatever the
// extractor measured has to survive the round trip, or they see less than the CLI.
describe('stored symbol rows', () => {
  it('bring back the declaration offset and all three arity states', () => {
    const surface = rowsToSurface(
      'cookie',
      '1.1.1',
      [
        row({ path: 'counted', sourceOffset: 42, maxArity: 2 }),
        row({ path: 'unbounded', maxArity: UNBOUNDED_ARITY }),
        row({ path: 'unmeasured' }),
      ],
      'shipped_js_ast',
    );
    const byPath = new Map(surface.symbols.map((s) => [s.path, s]));
    expect(byPath.get('counted')).toMatchObject({
      maxArity: 2,
      sourceRef: { file: 'dist/index.js', line: 1, offset: 42 },
    });
    expect(byPath.get('unbounded')!.maxArity).toBeNull();
    expect(byPath.get('unmeasured')).not.toHaveProperty('maxArity');
    expect(byPath.get('unmeasured')!.sourceRef).not.toHaveProperty('offset');
  });

  it('let a diff read from storage find a proven rename', () => {
    const from = rowsToSurface(
      'cookie',
      '1.1.1',
      [
        row({ path: 'parse', sourceLine: 87, sourceOffset: 2100 }),
        row({ path: 'parseCookie', sourceLine: 87, sourceOffset: 2100 }),
      ],
      'shipped_js_ast',
    );
    const to = rowsToSurface(
      'cookie',
      '2.0.1',
      [row({ path: 'parseCookie', sourceOffset: 900 })],
      'shipped_js_ast',
    );
    expect(diffSurfaces(from, to).renamed).toEqual([{ path: 'parse', to: ['parseCookie'] }]);
  });

  // Rows from before offsets were stored: no proof, so no rename claimed.
  it('claim nothing for rows stored without offsets', () => {
    const from = rowsToSurface(
      'cookie',
      '1.1.1',
      [row({ path: 'parse', sourceLine: 87 }), row({ path: 'parseCookie', sourceLine: 87 })],
      'shipped_js_ast',
    );
    const to = rowsToSurface('cookie', '2.0.1', [row({ path: 'parseCookie' })], 'shipped_js_ast');
    expect(diffSurfaces(from, to).renamed).toEqual([]);
  });
});
