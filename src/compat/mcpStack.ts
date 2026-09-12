/**
 * Stack compatibility for MCP servers.
 *
 * The npm question — "will these install together" — does not apply here.
 * Servers are separate processes; nothing resolves between them and there are
 * no peer ranges to clash. They conflict somewhere npm has no equivalent for:
 * the agent sees ONE FLAT TOOL NAMESPACE assembled from all of them, and two
 * servers exposing the same tool name put the agent in a position where it
 * cannot express which one it means.
 *
 * That failure is silent in the worst way. Depending on the client, one tool
 * shadows the other or the later registration wins — either way the agent calls
 * `search` and reaches a server the user did not intend, with the arguments of
 * the one they did. No error is raised, because nothing is broken; the names
 * are simply ambiguous and something has to pick.
 *
 * The second cost is emergent rather than a clash: every tool's schema is in
 * the agent's context on every single request, so a stack is also a standing
 * token bill the user never sees itemised.
 *
 * Same verdict discipline as `checkCompat`: `unknown` when a member could not
 * be read, never a hedge on a set that WAS read. A collision check that
 * silently skips the server it could not probe would report a clean namespace
 * for a stack it never assembled.
 */
import type { Database } from '../db/client';
import { loadStored, rowsToSurface } from '../mcp/surfaceHandlers';
import { contractOf, MCP_TIER } from '../surface/mcp';

export type McpStackVerdict = 'conflict' | 'compatible' | 'unknown';

export interface McpToolRef {
  server: string;
  version: string | null;
}

export interface McpCollision {
  /** The tool name two or more servers both expose. */
  tool: string;
  servers: string[];
  /**
   * True when at least one of the colliding tools can modify something.
   *
   * A shadowed read is a wrong answer; a shadowed write is a wrong answer that
   * changes somebody's data, so the two do not deserve the same severity.
   */
  writes: boolean;
}

export interface McpStackMember {
  server: string;
  version: string | null;
  /** Null when the server has never been probed. */
  tools: number | null;
  /** Tools that can modify something, by their own annotations. */
  writes: number;
  destroys: number;
}

export interface McpStackReport {
  overall: McpStackVerdict;
  members: McpStackMember[];
  collisions: McpCollision[];
  /** Every tool the agent will be handed. Null when any member was unread. */
  totalTools: number | null;
  /** Rough tokens these schemas occupy in EVERY request. Null when unread. */
  estimatedContextTokens: number | null;
  /** Servers with no stored surface — why `overall` can be `unknown`. */
  unread: string[];
  note: string;
}

/**
 * Rough token cost of one tool definition.
 *
 * A deliberate order-of-magnitude figure, not a measurement: name, description
 * and a JSON Schema, as most clients serialize them. It exists so a user with
 * forty tools sees that the standing cost is real, and it is described as
 * approximate everywhere it surfaces rather than dressed up as precision we do
 * not have.
 *
 * ponytail: a constant. Count real tokens per tool if anyone starts making
 * budget decisions on this number.
 */
const TOKENS_PER_TOOL = 250;

/** Total tools past which a stack is worth trimming rather than growing. */
const CROWDED_TOOL_COUNT = 60;

export async function checkMcpStack(
  db: Database,
  servers: McpToolRef[],
  tenantId = 0,
): Promise<McpStackReport> {
  const members: McpStackMember[] = [];
  const unread: string[] = [];
  /** tool name → servers exposing it, in configuration order. */
  const byTool = new Map<string, { servers: string[]; writes: boolean }>();

  for (const s of servers) {
    const stored = await loadStored(db, s.server, s.version, tenantId, 'mcp_server');
    if (!stored || stored.rows.length === 0 || stored.verdict === 'verified_false') {
      unread.push(s.server);
      members.push({ server: s.server, version: s.version, tools: null, writes: 0, destroys: 0 });
      continue;
    }
    const surface = rowsToSurface(s.server, s.version, stored.rows, MCP_TIER);
    let writes = 0;
    let destroys = 0;
    for (const sym of surface.symbols) {
      const ann = contractOf(sym)?.annotations;
      // Absent annotations resolve to the spec defaults, which are NOT benign:
      // a tool that declares nothing is assumed to write and to destroy.
      const canWrite = ann ? !ann.readOnlyHint : true;
      const canDestroy = ann ? ann.destructiveHint : true;
      if (canWrite) writes++;
      if (canDestroy) destroys++;

      const seen = byTool.get(sym.path);
      if (seen) {
        if (!seen.servers.includes(s.server)) seen.servers.push(s.server);
        seen.writes ||= canWrite;
      } else {
        byTool.set(sym.path, { servers: [s.server], writes: canWrite });
      }
    }
    members.push({
      server: s.server,
      version: s.version,
      tools: surface.symbols.length,
      writes,
      destroys,
    });
  }

  const collisions: McpCollision[] = [...byTool.entries()]
    .filter(([, v]) => v.servers.length > 1)
    .map(([tool, v]) => ({ tool, servers: v.servers, writes: v.writes }))
    .sort((a, b) => (a.tool < b.tool ? -1 : 1));

  const readMembers = members.filter((m) => m.tools !== null);
  const totalTools = unread.length ? null : readMembers.reduce((n, m) => n + (m.tools ?? 0), 0);

  const overall: McpStackVerdict =
    collisions.length > 0 ? 'conflict' : unread.length > 0 ? 'unknown' : 'compatible';

  const note =
    collisions.length > 0
      ? `${collisions.length} tool name(s) are exposed by more than one server; the agent has no way to say which one it means`
      : unread.length > 0
        ? `${unread.length} server(s) have not been probed, so the namespace was only partly assembled — this is NOT a clean bill`
        : `${totalTools} tool(s) across ${readMembers.length} server(s), no name collisions`;

  return {
    overall,
    members,
    collisions,
    totalTools,
    estimatedContextTokens: totalTools === null ? null : totalTools * TOKENS_PER_TOOL,
    unread,
    note,
  };
}

/** Is this stack large enough that its standing context cost is worth naming? */
export function isCrowded(report: McpStackReport): boolean {
  return (report.totalTools ?? 0) >= CROWDED_TOOL_COUNT;
}

export { CROWDED_TOOL_COUNT, TOKENS_PER_TOOL };
