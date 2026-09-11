/**
 * MCP tool-surface normalization and drift.
 *
 * Two halves, on purpose. The synthetic cases pin each classification rule to a
 * minimal input so a failure names the rule that broke. The fixture cases run
 * the real `tools/list` payloads of two published servers — captured by probing
 * @modelcontextprotocol/server-everything and server-memory across five
 * published versions each — because every false positive this module has had so
 * far came from a shape no hand-written fixture contained.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';
import {
  canonicalize,
  contractOf,
  diffMcpSurfaces,
  isWidening,
  looksDeprecated,
  mcpSurface,
  resolveAnnotations,
  surfaceHash,
  toolToSymbol,
  type McpTool,
} from '../src/surface/mcp';
import { summarize } from '../src/mcp/mcpHandlers';

const fixture = (name: string): McpTool[] =>
  JSON.parse(readFileSync(join(__dirname, 'fixtures/mcp', name), 'utf8')) as McpTool[];

const tool = (name: string, over: Partial<McpTool> = {}): McpTool => ({
  name,
  description: `does ${name}`,
  inputSchema: { type: 'object', properties: { a: { type: 'string' } }, required: ['a'] },
  ...over,
});

const drift = (from: McpTool[], to: McpTool[]) =>
  diffMcpSurfaces(mcpSurface('srv', '1.0.0', from), mcpSurface('srv', '2.0.0', to));

describe('canonicalize', () => {
  it('collapses the spellings JSON Schema treats as equivalent', () => {
    expect(canonicalize({ type: ['string'] })).toEqual({ type: 'string' });
    expect(canonicalize({ type: 'string', required: [] })).toEqual({ type: 'string' });
    expect(JSON.stringify(canonicalize({ b: 1, a: 2 }))).toBe(JSON.stringify({ a: 2, b: 1 }));
  });

  it('strips prose and dialect metadata but keeps semantics', () => {
    const c = canonicalize({
      $schema: 'http://json-schema.org/draft-07/schema#',
      description: 'a thing',
      title: 'Thing',
      type: 'string',
      default: 'x',
      additionalProperties: false,
    }) as Record<string, unknown>;
    expect(c).toEqual({ type: 'string', default: 'x', additionalProperties: false });
  });

  // A property may legally be named `type` or `required`; collapsing those the
  // way the sibling keywords are collapsed would corrupt the schema.
  it('leaves user-defined properties named after keywords alone', () => {
    const c = canonicalize({
      type: 'object',
      properties: { type: { type: 'string' }, required: { type: 'boolean' } },
    });
    expect(c).toEqual({
      type: 'object',
      properties: { type: { type: 'string' }, required: { type: 'boolean' } },
    });
  });
});

describe('resolveAnnotations', () => {
  // The spec's defaults are not all false. Comparing raw annotation objects
  // would report a flip every time a server started stating a hint it had been
  // inheriting — which is exactly what both real servers did in 2026.
  it('applies the spec defaults, which are not all false', () => {
    expect(resolveAnnotations(undefined)).toEqual({
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: false,
      openWorldHint: true,
    });
  });

  it('does not report a flip when a server states an inherited default', () => {
    const before = [tool('t')];
    const after = [tool('t', { annotations: { destructiveHint: true, openWorldHint: true } })];
    expect(drift(before, after).annotationFlips).toEqual([]);
  });
});

describe('toolToSymbol', () => {
  it('uses required-parameter count as the arity analogue', () => {
    expect(toolToSymbol(tool('t')).arity).toBe(1);
    expect(toolToSymbol(tool('t', { inputSchema: { type: 'object' } })).arity).toBe(0);
  });

  it('tags the MCP tier so a cross-tier diff is refused', () => {
    expect(toolToSymbol(tool('t')).tier).toBe('mcp_tools_list');
  });

  it('round-trips the contract through the signature field', () => {
    const c = contractOf(toolToSymbol(tool('t')));
    expect(c?.annotations.destructiveHint).toBe(true);
    expect(c?.prose).toHaveLength(16);
  });
});

describe('looksDeprecated', () => {
  it('reads an anchored marker', () => {
    expect(looksDeprecated({ name: 't', description: 'DEPRECATED: use foo' })).toBe(true);
    expect(looksDeprecated({ name: 't', description: '[deprecated] use foo' })).toBe(true);
  });

  // An unanchored substring match marks a healthy tool as dying, and a false
  // deprecation costs more trust than staying silent.
  it('does not fire on a tool that merely mentions deprecation', () => {
    expect(looksDeprecated({ name: 't', description: 'Replaces the deprecated foo API' })).toBe(
      false,
    );
  });
});

describe('surfaceHash', () => {
  it('is order-independent', () => {
    const a = [tool('x'), tool('y')];
    expect(surfaceHash(a)).toBe(surfaceHash([...a].reverse()));
  });

  it('changes when prose changes, so a stored surface refreshes', () => {
    expect(surfaceHash([tool('x')])).not.toBe(surfaceHash([tool('x', { description: 'new' })]));
  });
});

describe('diffMcpSurfaces — guards', () => {
  // Inherited from diffSurfaces (§6.4.2). On this tier the empty side is not a
  // failed extraction but an undrained pagination cursor, which is the single
  // most likely way to manufacture a false mass-removal.
  it('refuses to read removals out of an empty surface', () => {
    const d = drift([], [tool('a')]);
    expect(d.inconclusive).toMatch(/empty/);
    expect(d.removedTools).toEqual([]);
    expect(d.breaking).toBe(false);
  });

  it('refuses to diff an MCP surface against a package surface', () => {
    const pkg = {
      package: 'srv',
      version: '1.0.0',
      tier: 'shipped_js_ast' as const,
      entry: null,
      symbols: [
        {
          path: 'a',
          kind: 'function' as const,
          arity: 0,
          origin: 'local' as const,
          deprecated: false,
          tier: 'shipped_js_ast' as const,
        },
      ],
      filesWalked: 1,
      externalReExports: [],
    };
    const d = diffMcpSurfaces(pkg, mcpSurface('srv', '2.0.0', [tool('a')]));
    expect(d.inconclusive).toMatch(/cross-tier/);
  });
});

describe('diffMcpSurfaces — classification', () => {
  it('flags a removed tool as breaking', () => {
    const d = drift([tool('a'), tool('b')], [tool('a')]);
    expect(d.removedTools).toEqual(['b']);
    expect(d.breaking).toBe(true);
  });

  it('flags a newly-required parameter as breaking', () => {
    const before = [
      tool('t', { inputSchema: { type: 'object', properties: { a: { type: 'string' } } } }),
    ];
    const after = [
      tool('t', {
        inputSchema: { type: 'object', properties: { a: { type: 'string' } }, required: ['a'] },
      }),
    ];
    const d = drift(before, after);
    expect(d.requiredAdded).toEqual([{ tool: 't', params: ['a'] }]);
    expect(d.breaking).toBe(true);
  });

  it('does not double-report a brand new required parameter as a dropped one', () => {
    const before = [tool('t', { inputSchema: { type: 'object', properties: {} } })];
    const after = [tool('t')];
    const d = drift(before, after);
    expect(d.paramsAdded).toEqual([{ tool: 't', params: ['a'] }]);
    expect(d.paramsRemoved).toEqual([]);
  });

  it('treats a relaxed requirement and an added optional param as compatible', () => {
    const before = [tool('t')];
    const after = [
      tool('t', {
        inputSchema: {
          type: 'object',
          properties: { a: { type: 'string' }, b: { type: 'number' } },
        },
      }),
    ];
    const d = drift(before, after);
    expect(d.requiredRelaxed).toEqual([{ tool: 't', params: ['a'] }]);
    expect(d.paramsAdded).toEqual([{ tool: 't', params: ['b'] }]);
    expect(d.breaking).toBe(false);
  });

  it('separates a narrowed type from a widened one', () => {
    const narrow = drift(
      [tool('t')],
      [tool('t', { inputSchema: { type: 'object', properties: { a: { type: 'number' } }, required: ['a'] } })],
    );
    expect(narrow.typeChanged[0]?.widened).toBe(false);
    expect(narrow.breaking).toBe(true);

    const wide = drift(
      [tool('t')],
      [
        tool('t', {
          inputSchema: {
            type: 'object',
            properties: { a: { type: ['string', 'number'] } },
            required: ['a'],
          },
        }),
      ],
    );
    expect(wide.typeChanged[0]?.widened).toBe(true);
    expect(wide.breaking).toBe(false);
  });
});

describe('annotation flips', () => {
  // Not a breaking change, and worse than one: a tool that gained a required
  // parameter fails on the next call, a tool that stopped being read-only
  // succeeds and writes.
  it('marks a tool that stopped being read-only as widening privilege', () => {
    const d = drift(
      [tool('t', { annotations: { readOnlyHint: true } })],
      [tool('t', { annotations: { readOnlyHint: false } })],
    );
    const flip = d.annotationFlips.find((f) => f.hint === 'readOnlyHint');
    expect(flip?.widensPrivilege).toBe(true);
    expect(d.breaking).toBe(false);
  });

  it('marks a tool that became destructive as widening privilege', () => {
    const d = drift(
      [tool('t', { annotations: { destructiveHint: false } })],
      [tool('t', { annotations: { destructiveHint: true } })],
    );
    expect(d.annotationFlips.find((f) => f.hint === 'destructiveHint')?.widensPrivilege).toBe(true);
  });

  it('does not mark a tool that became safer as widening privilege', () => {
    const d = drift(
      [tool('t', { annotations: { destructiveHint: true } })],
      [tool('t', { annotations: { destructiveHint: false } })],
    );
    expect(d.annotationFlips.every((f) => !f.widensPrivilege)).toBe(true);
  });
});

describe('silent drift vs. prose', () => {
  // The documented 2026 failure: parameter fingerprints move while the
  // human-readable text stays byte-identical, so nothing a changelog reader can
  // see has changed.
  it('reports a schema change with an unchanged description as silent', () => {
    const after = [
      tool('t', {
        inputSchema: { type: 'object', properties: { a: { type: 'number' } }, required: ['a'] },
      }),
    ];
    const d = drift([tool('t')], after);
    expect(d.silentDrift).toEqual(['t']);
    expect(d.prosePolished).toEqual([]);
  });

  it('reports a description-only edit as cosmetic, never breaking', () => {
    const d = drift([tool('t')], [tool('t', { description: 'rewritten copy' })]);
    expect(d.prosePolished).toEqual(['t']);
    expect(d.silentDrift).toEqual([]);
    expect(d.breaking).toBe(false);
  });
});

describe('isWidening', () => {
  it('proves the relaxations it claims to', () => {
    expect(isWidening({ type: 'string' }, { type: ['string', 'number'] })).toBe(true);
    expect(isWidening({ enum: ['a'] }, { enum: ['a', 'b'] })).toBe(true);
    expect(isWidening({ additionalProperties: false }, {})).toBe(true);
    expect(isWidening({ required: ['a'] }, {})).toBe(true);
    expect(
      isWidening(
        { type: 'array', items: { type: 'object', additionalProperties: false } },
        { type: 'array', items: { type: 'object' } },
      ),
    ).toBe(true);
  });

  it('refuses anything it cannot prove', () => {
    expect(isWidening({ type: ['string', 'number'] }, { type: 'string' })).toBe(false);
    expect(isWidening({}, { additionalProperties: false })).toBe(false);
    expect(isWidening({}, { required: ['a'] })).toBe(false);
    // A keyword outside the relaxable set is never assumed permissive.
    expect(isWidening({ minimum: 0 }, { minimum: 5 })).toBe(false);
    expect(isWidening({ pattern: '^a' }, { pattern: '^b' })).toBe(false);
  });
});

/**
 * Real payloads from published servers. These exist because every false
 * positive this module has had came from a shape no hand-written case had:
 * `$schema` appearing mid-history, `additionalProperties: false` being dropped
 * deep inside an `items` subtree, annotations arriving on every tool at once.
 */
describe('real published servers', () => {
  it('reads the everything server whole, schemas included', () => {
    const tools = fixture('everything-2026.7.4.json');
    expect(tools).toHaveLength(13);
    const sum = tools.find((t) => t.name === 'get-sum')!;
    expect(sum.inputSchema).toBeDefined();
    const sym = toolToSymbol(sum);
    expect(sym.arity).toBe(2); // a, b
    expect(contractOf(sym)?.annotations.readOnlyHint).toBe(true);
  });

  it('catches the 2026.1 mass rename as breaking', () => {
    const d = diffMcpSurfaces(
      mcpSurface('everything', '2025.11.25', fixture('everything-2025.11.25.json')),
      mcpSurface('everything', '2026.1.14', fixture('everything-2026.1.14.json')),
    );
    expect(d.breaking).toBe(true);
    // `add` became `get-sum`, `printEnv` became `get-env`, and so on: a rename
    // is a removal plus an addition, and it breaks every existing caller.
    expect(d.removedTools).toContain('add');
    expect(d.removedTools).toContain('printEnv');
    expect(d.addedTools).toContain('get-sum');
    expect(d.addedTools).toContain('get-env');
  });

  it('catches the everything server annotating every tool as silent drift', () => {
    const d = diffMcpSurfaces(
      mcpSurface('everything', '2026.1.14', fixture('everything-2026.1.14.json')),
      mcpSurface('everything', '2026.7.4', fixture('everything-2026.7.4.json')),
    );
    // Twelve tools gained annotations with no description edit. Nothing broke,
    // and nothing in a changelog would have said so.
    expect(d.silentDrift.length).toBeGreaterThan(10);
    expect(d.breaking).toBe(false);
    expect(d.annotationFlips.every((f) => !f.widensPrivilege)).toBe(true);
  });

  /**
   * The regression this whole fixture set exists for.
   *
   * server-memory 2025.11.25 added `$schema` and dropped
   * `additionalProperties: false` from inside every `items` subtree. Both are
   * relaxations. Before the widening check learned to recurse, this pair
   * reported five breaking type changes on an upgrade that broke nothing.
   */
  it('does not call the memory server relaxation a break', () => {
    const d = diffMcpSurfaces(
      mcpSurface('memory', '2025.9.24', fixture('memory-2025.9.24.json')),
      mcpSurface('memory', '2025.11.25', fixture('memory-2025.11.25.json')),
    );
    expect(d.removedTools).toEqual([]);
    expect(d.typeChanged.length).toBeGreaterThan(0);
    expect(d.typeChanged.every((c) => c.widened)).toBe(true);
    expect(d.breaking).toBe(false);
  });

  it('is stable across a version that changed nothing', () => {
    const tools = fixture('memory-2026.7.4.json');
    const d = diffMcpSurfaces(mcpSurface('memory', 'a', tools), mcpSurface('memory', 'b', tools));
    expect(d.breaking).toBe(false);
    expect(surfaceHash(tools)).toBe(surfaceHash([...tools].reverse()));
    expect([
      ...d.removedTools,
      ...d.addedTools,
      ...d.silentDrift,
      ...d.prosePolished,
      ...d.typeChanged,
    ]).toEqual([]);
  });
});

describe('drift summary', () => {
  const base = drift([tool('t')], [tool('t')]);

  it('leads with privilege widening, ahead of anything that merely breaks', () => {
    const d = {
      ...base,
      removedTools: ['gone'],
      annotationFlips: [
        {
          tool: 'write_file',
          hint: 'readOnlyHint' as const,
          from: true,
          to: false,
          widensPrivilege: true,
        },
      ],
    };
    expect(summarize(d)).toMatch(/^1 privilege widening/);
    expect(summarize(d)).toContain('1 tool(s) removed');
  });

  /**
   * The regression: a release that relaxed five parameter types and changed
   * nine output schemas printed "no contract change" — true about breakage, and
   * false about the contract, which is the word in the sentence.
   */
  it('names compatible movement instead of calling it no change', () => {
    const d = {
      ...base,
      typeChanged: [{ tool: 't', param: 'a', from: '{}', to: '{}', widened: true }],
      outputChanged: ['t'],
    };
    const line = summarize(d);
    expect(line).toMatch(/^compatible:/);
    expect(line).toContain('1 param type(s) relaxed');
    expect(line).toContain('1 output schema(s) changed');
  });

  it('says nothing changed only when nothing did', () => {
    expect(summarize(base)).toBe('no contract change');
  });
});
