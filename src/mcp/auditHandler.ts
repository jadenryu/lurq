/**
 * `audit` — assess a whole project in one call.
 *
 * The split matters. Discovery runs on the caller's machine (`src/audit/
 * inventory.ts`) and reads manifests and agent configs; what crosses the wire
 * is a list of names and versions, never a source file. This handler takes that
 * list and answers against the index.
 *
 * One call for the whole project rather than a loop over `evaluate`: a
 * forty-package repo is one round trip, and the batching inside `assess` keeps
 * it one indexed read plus one OSV post regardless of size.
 */
import type { Database } from '../db/client';
import { assessInventory, queueUnknown } from '../audit/assess';
import type { AuditReport, Inventory } from '../audit/types';

export interface AuditInput {
  packages?: { name: string; range?: string; installed?: string | null }[];
  mcpServers?: {
    alias?: string;
    kind?: string;
    packageName?: string | null;
    version?: string | null;
    endpoint?: string | null;
  }[];
  notes?: string[];
}

/** Guard against a caller shipping an unbounded inventory. */
const MAX = 600;

export async function handleAudit(db: Database, input: AuditInput): Promise<AuditReport> {
  const notes = [...(input.notes ?? [])];
  const pkgs = (input.packages ?? []).slice(0, MAX);
  const servers = (input.mcpServers ?? []).slice(0, Math.max(0, MAX - pkgs.length));
  if ((input.packages?.length ?? 0) + (input.mcpServers?.length ?? 0) > MAX) {
    notes.push(`inventory exceeded ${MAX} items; the remainder were not assessed`);
  }

  const inv: Inventory = {
    root: '',
    packages: pkgs.map((p) => ({
      name: p.name,
      range: p.range ?? '*',
      installed: p.installed ?? null,
      sources: [],
    })),
    mcpServers: servers.map((s) => ({
      alias: s.alias ?? s.packageName ?? 'server',
      // Trust but bound: an unknown kind is treated as the least capable case
      // rather than assumed probeable, so a bad client cannot make lurq claim
      // it read something it did not.
      kind:
        s.kind === 'npm-stdio' ||
        s.kind === 'remote' ||
        s.kind === 'local' ||
        s.kind === 'other-registry'
          ? s.kind
          : 'local',
      packageName: s.packageName ?? null,
      version: s.version ?? null,
      endpoint: s.endpoint ?? null,
      sources: [],
    })),
    filesRead: [],
    notes,
  };

  const report = await assessInventory(db, inv);
  await queueUnknown(db, report);
  // `root` is the caller's path and is not ours to echo back.
  return { ...report, root: null };
}
