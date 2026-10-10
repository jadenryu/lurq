/**
 * MCP stack compatibility.
 *
 * The npm question — "will these install together" — does not apply: servers
 * are separate processes with nothing to resolve between them. They conflict
 * where npm has no equivalent, in the ONE FLAT TOOL NAMESPACE the agent
 * assembles from all of them. Two servers exposing `search` leave the agent
 * unable to express which it means, and nothing raises an error: one simply
 * shadows the other.
 */
import { describe, expect, it } from 'vitest';
import { checkMcpStack, isCrowded, CROWDED_TOOL_COUNT } from '../src/compat/mcpStack';
import { toolToSymbol, type McpTool } from '../src/surface/mcp';
import type { Database } from '../src/db/client';

const tool = (name: string, readOnly = true): McpTool => ({
  name,
  description: `does ${name}`,
  inputSchema: { type: 'object', properties: { a: { type: 'string' } } },
  annotations: { readOnlyHint: readOnly, destructiveHint: !readOnly },
});

/** A db whose stored-surface reads return the given tools per server. */
function dbWith(byServer: Record<string, McpTool[] | null>): Database {
  return {
    __surfaces: byServer,
    select: () => ({ from: () => ({ where: () => ({ limit: () => Promise.resolve([]) }) }) }),
  } as unknown as Database;
}

// loadStored is the seam; stub it rather than a whole drizzle chain.
import * as handlers from '../src/mcp/surfaceHandlers';
import { vi } from 'vitest';

function stubSurfaces(byServer: Record<string, McpTool[] | null>) {
  vi.spyOn(handlers, 'loadStored').mockImplementation(async (_db, pkg) => {
    const tools = byServer[pkg];
    if (!tools) return null;
    return {
      entityId: 1,
      rows: tools.map((t) => {
        const s = toolToSymbol(t);
        return {
          id: 1,
          entityId: 1,
          path: s.path,
          kind: s.kind,
          arity: s.arity,
          origin: s.origin,
          deprecated: s.deprecated,
          tier: s.tier,
          signature: s.signature ?? null,
          sourceFile: null,
          sourceLine: null,
          sourceOffset: null,
          maxArity: null,
        };
      }),
      verdict: 'verified_true' as const,
      class: 'declared' as const,
      tier: 'mcp_tools_list' as const,
      observedAt: null,
      private: false,
    };
  });
}

const ref = (server: string) => ({ server, version: null });

describe('tool-name collisions', () => {
  it('flags a name two servers both expose', async () => {
    stubSurfaces({ a: [tool('search'), tool('fetch')], b: [tool('search')] });
    const r = await checkMcpStack(dbWith({}), [ref('a'), ref('b')]);
    expect(r.overall).toBe('conflict');
    expect(r.collisions).toHaveLength(1);
    expect(r.collisions[0]).toMatchObject({ tool: 'search', servers: ['a', 'b'] });
  });

  // A shadowed read returns the wrong answer; a shadowed write changes the
  // wrong data. They do not deserve the same severity.
  it('marks a collision that can modify something', async () => {
    stubSurfaces({ a: [tool('sync', false)], b: [tool('sync')] });
    expect((await checkMcpStack(dbWith({}), [ref('a'), ref('b')])).collisions[0]!.writes).toBe(
      true,
    );
  });

  it('says compatible when the namespaces are disjoint', async () => {
    stubSurfaces({ a: [tool('search')], b: [tool('write')] });
    const r = await checkMcpStack(dbWith({}), [ref('a'), ref('b')]);
    expect(r.overall).toBe('compatible');
    expect(r.collisions).toEqual([]);
    expect(r.totalTools).toBe(2);
  });

  it('does not report a server as colliding with itself', async () => {
    stubSurfaces({ a: [tool('search'), tool('search')] });
    expect((await checkMcpStack(dbWith({}), [ref('a')])).collisions).toEqual([]);
  });
});

describe('a partly-read stack is unknown, never clean', () => {
  /**
   * The same rule `checkCompat` holds: `unknown` when a member could not be
   * read, never a hedge on a set that WAS read. Skipping the server we could
   * not probe would report a clean namespace for a stack never assembled.
   */
  it('reports unknown when a server has never been probed', async () => {
    stubSurfaces({ a: [tool('search')], b: null });
    const r = await checkMcpStack(dbWith({}), [ref('a'), ref('b')]);
    expect(r.overall).toBe('unknown');
    expect(r.unread).toEqual(['b']);
    expect(r.totalTools).toBeNull();
    expect(r.note).toMatch(/NOT a clean bill/);
  });

  // A real collision outranks an incomplete read: it is proven, and proven
  // findings are never downgraded by a gap elsewhere.
  it('still reports conflict when one member is unread but another collides', async () => {
    stubSurfaces({ a: [tool('search')], b: [tool('search')], c: null });
    expect((await checkMcpStack(dbWith({}), [ref('a'), ref('b'), ref('c')])).overall).toBe(
      'conflict',
    );
  });
});

describe('context cost', () => {
  it('counts the standing schema budget across the stack', async () => {
    stubSurfaces({ a: [tool('x'), tool('y')] });
    const r = await checkMcpStack(dbWith({}), [ref('a')]);
    expect(r.estimatedContextTokens).toBe(2 * 250);
  });

  it('flags a crowded stack, and only a crowded one', async () => {
    const many = Array.from({ length: CROWDED_TOOL_COUNT }, (_, i) => tool(`t${i}`));
    stubSurfaces({ big: many });
    expect(isCrowded(await checkMcpStack(dbWith({}), [ref('big')]))).toBe(true);
    stubSurfaces({ small: [tool('x')] });
    expect(isCrowded(await checkMcpStack(dbWith({}), [ref('small')]))).toBe(false);
  });

  // Absent annotations resolve to the spec defaults, which are not benign.
  it('assumes a tool that declares nothing can write and destroy', async () => {
    stubSurfaces({ a: [{ name: 'mystery' }] });
    const r = await checkMcpStack(dbWith({}), [ref('a')]);
    expect(r.members[0]).toMatchObject({ writes: 1, destroys: 1 });
  });
});

describe('tools read live by the caller', () => {
  // The only way to cover a remote, PyPI, Docker or private server: the client
  // already holds the list, so the index is never consulted.
  it('analyses inline tools without touching the index', async () => {
    const spy = vi.spyOn(handlers, 'loadStored');
    spy.mockClear();
    const r = await checkMcpStack(dbWith({}), [
      { server: 'github (remote)', version: null, tools: [{ name: 'search' }] },
      {
        server: 'linear',
        version: null,
        tools: [{ name: 'search', annotations: { readOnlyHint: true } }],
      },
    ]);
    expect(spy).not.toHaveBeenCalled();
    expect(r.overall).toBe('conflict');
    // The unannotated one is assumed to write, so the collision is a write.
    expect(r.collisions[0]).toMatchObject({ tool: 'search', writes: true });
  });

  it('mixes inline and indexed members in one stack', async () => {
    stubSurfaces({ a: [tool('fetch')] });
    const r = await checkMcpStack(dbWith({}), [
      ref('a'),
      { server: 'b', version: null, tools: [] },
    ]);
    expect(r.overall).toBe('compatible');
    expect(r.totalTools).toBe(1);
  });
});

describe('an unread server is queued, so the answer improves', () => {
  it('enqueues a never-probed npm server', async () => {
    const surface = await import('../src/db/surface');
    const enqueue = vi.spyOn(surface, 'enqueueSurface').mockResolvedValue();
    stubSurfaces({ a: null });
    await checkMcpStack(dbWith({}), [{ server: '@scope/server', version: '1.2.3' }]);
    expect(enqueue).toHaveBeenCalledWith(expect.anything(), '@scope/server', '1.2.3', 'mcp_server');
    enqueue.mockRestore();
  });

  it('does not re-queue a server already probed and found broken', async () => {
    const surface = await import('../src/db/surface');
    const enqueue = vi.spyOn(surface, 'enqueueSurface').mockResolvedValue();
    vi.spyOn(handlers, 'loadStored').mockResolvedValue({
      entityId: 1,
      rows: [],
      verdict: 'verified_false',
      class: 'executed',
      tier: 'mcp_tools_list',
      observedAt: null,
    } as never);
    const r = await checkMcpStack(dbWith({}), [ref('broken')]);
    expect(r.unread).toEqual(['broken']);
    expect(enqueue).not.toHaveBeenCalled();
    enqueue.mockRestore();
  });
});
