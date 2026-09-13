/**
 * What one live connection to an MCP server yielded, normalised.
 *
 * The protocol fixes the shape of `tools/list`, but servers are written by
 * thousands of people and the wire does not enforce it. The SDK's own client
 * validates strictly, so ONE malformed tool fails the whole list and the user
 * learns nothing about the other forty. Here every entry is parsed on its own:
 * a bad one becomes an issue, the rest become the contract.
 *
 * Every ceiling below exists because a scan runs someone else's program and
 * then stores and uploads what it said. A server that returns a 50MB schema or
 * paginates forever must cost us a bounded amount, and say so in `issues`
 * rather than silently shrinking.
 */
import { createHash } from 'node:crypto';
import { surfaceHash, type McpTool } from '../surface/mcp';

export const LIMITS = {
  tools: 2000,
  prompts: 1000,
  resourceTemplates: 1000,
  /** `resources/list` is paged only to count; URIs are the user's data, never kept. */
  resourcePages: 50,
  pages: 100,
  name: 256,
  text: 32_000,
  instructions: 32_000,
  schemaBytes: 200_000,
  schemaDepth: 64,
} as const;

export type ListName = 'tools' | 'prompts' | 'resourceTemplates' | 'resources';

export interface SnapshotIssue {
  list: ListName | 'initialize';
  kind: 'malformed' | 'duplicate' | 'oversized' | 'truncated' | 'list_failed' | 'stdout_noise';
  detail: string;
}

export interface PromptInfo {
  name: string;
  title?: string;
  description?: string;
  arguments: { name: string; description?: string; required: boolean }[];
}

export interface ResourceTemplateInfo {
  name: string;
  uriTemplate: string;
  title?: string;
  description?: string;
  mimeType?: string;
}

export interface Snapshot {
  serverInfo: { name: string | null; version: string | null; title: string | null };
  protocolVersion: string | null;
  capabilities: {
    tools: boolean;
    prompts: boolean;
    resources: boolean;
    logging: boolean;
    completions: boolean;
    toolsListChanged: boolean;
  };
  /** Server-level guidance the client puts in the model's context. */
  instructions: string | null;
  tools: McpTool[];
  prompts: PromptInfo[];
  resourceTemplates: ResourceTemplateInfo[];
  /** How many concrete resources were listed. Null when not listed. */
  resourceCount: number | null;
  issues: SnapshotIssue[];
}

const isObj = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === 'object' && !Array.isArray(v);

function text(v: unknown, max: number, issues: SnapshotIssue[], list: ListName, where: string) {
  if (typeof v !== 'string') return undefined;
  if (v.length <= max) return v;
  issues.push({ list, kind: 'oversized', detail: `${where}: ${v.length} chars, kept the first ${max}` });
  return v.slice(0, max);
}

/** Deepest nesting in a JSON value, walked iteratively so hostile depth cannot blow the stack. */
function depthOf(value: unknown, limit: number): number {
  let max = 0;
  const stack: [unknown, number][] = [[value, 1]];
  while (stack.length) {
    const [v, d] = stack.pop()!;
    if (d > max) max = d;
    if (max > limit) return max;
    if (v && typeof v === 'object') {
      for (const child of Array.isArray(v) ? v : Object.values(v)) {
        if (child && typeof child === 'object') stack.push([child, d + 1]);
      }
    }
  }
  return max;
}

/**
 * A JSON Schema kept as-is unless it would cost more than it is worth.
 *
 * Replaced, not truncated: half a schema is a different schema, and diffing a
 * truncated one against a whole one would report changes that never happened.
 * The marker is stable, so an oversized schema that stays oversized is not
 * reported as drifting either.
 */
function schema(v: unknown, issues: SnapshotIssue[], list: ListName, where: string): unknown {
  if (v === undefined || v === null) return undefined;
  const depth = depthOf(v, LIMITS.schemaDepth);
  if (depth > LIMITS.schemaDepth) {
    issues.push({ list, kind: 'oversized', detail: `${where}: nested deeper than ${LIMITS.schemaDepth} levels` });
    return { 'x-lurq-omitted': `schema deeper than ${LIMITS.schemaDepth} levels` };
  }
  const bytes = JSON.stringify(v).length;
  if (bytes > LIMITS.schemaBytes) {
    issues.push({ list, kind: 'oversized', detail: `${where}: ${bytes} bytes` });
    return { 'x-lurq-omitted': `schema larger than ${LIMITS.schemaBytes} bytes` };
  }
  return v;
}

const HINTS = ['readOnlyHint', 'destructiveHint', 'idempotentHint', 'openWorldHint'] as const;

/**
 * Only the four hints and a title, and only when they are the right type.
 *
 * A string `"true"` is NOT coerced. The spec says boolean, the client an agent
 * uses will not coerce it either, so the honest reading of a mistyped hint is
 * that it was not declared — which means the pessimistic spec default applies.
 */
function annotations(v: unknown): Record<string, unknown> | undefined {
  if (!isObj(v)) return undefined;
  const out: Record<string, unknown> = {};
  for (const h of HINTS) if (typeof v[h] === 'boolean') out[h] = v[h];
  if (typeof v.title === 'string') out.title = v.title.slice(0, LIMITS.name);
  return Object.keys(out).length ? out : undefined;
}

/** Leniently normalise one page of entries, keyed by name, first occurrence wins. */
function each<T extends { name: string }>(
  raw: unknown[],
  list: ListName,
  seen: Map<string, T>,
  issues: SnapshotIssue[],
  cap: number,
  build: (entry: Record<string, unknown>, name: string) => T | null,
): boolean {
  for (let i = 0; i < raw.length; i++) {
    const entry = raw[i];
    if (!isObj(entry) || typeof entry.name !== 'string' || !entry.name.trim()) {
      issues.push({ list, kind: 'malformed', detail: `entry ${i} has no string name` });
      continue;
    }
    const name = entry.name.trim();
    if (name.length > LIMITS.name) {
      issues.push({ list, kind: 'malformed', detail: `a name is ${name.length} chars (limit ${LIMITS.name})` });
      continue;
    }
    if (seen.has(name)) {
      // Clients disagree on which copy wins; recording the first keeps the
      // contract deterministic and the issue says the ambiguity exists.
      issues.push({ list, kind: 'duplicate', detail: `"${name}" is listed more than once` });
      continue;
    }
    if (seen.size >= cap) {
      issues.push({ list, kind: 'truncated', detail: `more than ${cap} entries; the rest were not recorded` });
      return false;
    }
    const built = build(entry, name);
    if (built) seen.set(name, built);
  }
  return true;
}

export function addTools(raw: unknown[], seen: Map<string, McpTool>, issues: SnapshotIssue[]): boolean {
  return each(raw, 'tools', seen, issues, LIMITS.tools, (e, name) => {
    const tool: McpTool = { name };
    const title = text(e.title, LIMITS.name, issues, 'tools', `${name}.title`);
    const description = text(e.description, LIMITS.text, issues, 'tools', `${name}.description`);
    const input = schema(e.inputSchema, issues, 'tools', `${name}.inputSchema`);
    const output = schema(e.outputSchema, issues, 'tools', `${name}.outputSchema`);
    const ann = annotations(e.annotations);
    if (title !== undefined) tool.title = title;
    if (description !== undefined) tool.description = description;
    if (input !== undefined) tool.inputSchema = input;
    if (output !== undefined) tool.outputSchema = output;
    if (ann) tool.annotations = ann;
    return tool;
  });
}

export function addPrompts(raw: unknown[], seen: Map<string, PromptInfo>, issues: SnapshotIssue[]): boolean {
  return each(raw, 'prompts', seen, issues, LIMITS.prompts, (e, name) => {
    const args = Array.isArray(e.arguments) ? e.arguments : [];
    const prompt: PromptInfo = {
      name,
      arguments: args.filter(isObj).flatMap((a) =>
        typeof a.name === 'string'
          ? [
              {
                name: a.name.slice(0, LIMITS.name),
                ...(typeof a.description === 'string'
                  ? { description: a.description.slice(0, LIMITS.text) }
                  : {}),
                required: a.required === true,
              },
            ]
          : [],
      ),
    };
    const title = text(e.title, LIMITS.name, issues, 'prompts', `${name}.title`);
    const description = text(e.description, LIMITS.text, issues, 'prompts', `${name}.description`);
    if (title !== undefined) prompt.title = title;
    if (description !== undefined) prompt.description = description;
    return prompt;
  });
}

export function addTemplates(
  raw: unknown[],
  seen: Map<string, ResourceTemplateInfo>,
  issues: SnapshotIssue[],
): boolean {
  return each(raw, 'resourceTemplates', seen, issues, LIMITS.resourceTemplates, (e, name) => {
    if (typeof e.uriTemplate !== 'string') {
      issues.push({ list: 'resourceTemplates', kind: 'malformed', detail: `"${name}" has no uriTemplate` });
      return null;
    }
    const t: ResourceTemplateInfo = { name, uriTemplate: e.uriTemplate.slice(0, 2048) };
    const title = text(e.title, LIMITS.name, issues, 'resourceTemplates', `${name}.title`);
    const description = text(e.description, LIMITS.text, issues, 'resourceTemplates', `${name}.description`);
    if (title !== undefined) t.title = title;
    if (description !== undefined) t.description = description;
    if (typeof e.mimeType === 'string') t.mimeType = e.mimeType.slice(0, 200);
    return t;
  });
}

const sha = (s: string) => createHash('sha256').update(s).digest('hex');

const byName = <T extends { name: string }>(xs: T[]) =>
  [...xs].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));

/** Sorted-key JSON, so two equal values always serialize identically. */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(value, (_k, v) =>
    v && typeof v === 'object' && !Array.isArray(v)
      ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, (v as Record<string, unknown>)[k]]))
      : v,
  );
}

/**
 * Schema-only address — the existing `surfaceHash`, prose stripped. Equal hashes
 * mean an agent's calls validate identically.
 */
export function contractHash(s: Pick<Snapshot, 'tools'>): string {
  return surfaceHash(s.tools);
}

/**
 * Everything the model reads from this server: tools with their prose,
 * prompts, templates and instructions.
 *
 * Deliberately excludes what changes without the contract changing — the
 * self-reported version, the protocol revision, the resource count, and the
 * parse issues — so an unchanged server scanned daily stores nothing new.
 * Prose IS included: for MCP a description is an instruction to the model, and
 * a rewrite after approval is the attack, not a cosmetic edit.
 */
export function contentHash(
  s: Pick<Snapshot, 'tools' | 'prompts' | 'resourceTemplates' | 'instructions'>,
): string {
  return sha(
    canonicalJson({
      tools: byName(s.tools),
      prompts: byName(s.prompts),
      resourceTemplates: byName(s.resourceTemplates),
      instructions: s.instructions ?? null,
    }),
  );
}

export function emptySnapshot(): Snapshot {
  return {
    serverInfo: { name: null, version: null, title: null },
    protocolVersion: null,
    capabilities: {
      tools: false,
      prompts: false,
      resources: false,
      logging: false,
      completions: false,
      toolsListChanged: false,
    },
    instructions: null,
    tools: [],
    prompts: [],
    resourceTemplates: [],
    resourceCount: null,
    issues: [],
  };
}
