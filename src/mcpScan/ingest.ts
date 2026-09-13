/**
 * Server side of `lurq mcp-scan --upload`: accept what a client read, and turn
 * it into owner-scoped history.
 *
 * This is a trust boundary, and the client is treated accordingly. Its
 * normalization is repeated, its hashes are recomputed, its analysis is ignored
 * and redone, and credential shapes are scrubbed again — a modified or buggy
 * CLI must not be able to store an oversized blob, forge a hash that collides
 * with someone else's contract, or plant a finding-free analysis over a
 * poisoned description.
 */
import semver from 'semver';
import { z } from 'zod';
import { formatError } from '../core/errors';
import { logger } from '../core/logger';
import type { Database } from '../db/client';
import {
  countDeployments,
  deploymentExists,
  putContract,
  recordScan,
  reportPublic,
  type ChangeKind,
} from '../db/mcpScans';
import { enqueueSurface, mcpSurfaceRef, storeSurface } from '../db/surface';
import { loadStored } from '../mcp/surfaceHandlers';
import { mcpSurface, type McpTool } from '../surface/mcp';
import { analyzeServer, diffSnapshots, worst } from './analyze';
import type { ScanStatus } from './errors';
import { scrubDeep } from './redact';
import {
  addPrompts,
  addTemplates,
  addTools,
  contentHash,
  contractHash,
  LIMITS,
  type PromptInfo,
  type ResourceTemplateInfo,
  type SnapshotIssue,
} from './snapshot';

/** Bumped when analysis can produce a different answer for the same contract. */
export const ANALYZER_VERSION = '1';

export const MAX_SERVERS_PER_UPLOAD = 50;
/** One server's normalized contract, serialized. Real servers are well under 1MB. */
export const MAX_CONTRACT_BYTES = 4_000_000;
/** Distinct deployments one account may track; bounds abuse, not real use. */
export const MAX_DEPLOYMENTS_PER_OWNER = 1_000;
/** Distinct accounts that must read the same contract before it goes public. */
export const PUBLIC_QUORUM = 3;

/** Statuses a client may upload. Skipped servers were never contacted; nothing to record. */
const UPLOADABLE = [
  'ok',
  'partial',
  'needs_config',
  'auth_required',
  'spawn_failed',
  'timeout',
  'unreachable',
  'protocol_error',
] as const satisfies readonly ScanStatus[];

const REGISTRIES = ['npm', 'pypi', 'docker', 'remote', 'local'] as const;

const ServerSchema = z.object({
  alias: z.string().trim().min(1).max(200),
  serverKey: z.string().min(3).max(600),
  configFingerprint: z.string().regex(/^[0-9a-f]{16}$/, 'configFingerprint must be 16 hex characters'),
  registry: z.enum(REGISTRIES),
  packageName: z.string().max(300).nullable(),
  pinnedVersion: z.string().max(100).nullable(),
  transport: z.enum(['stdio', 'http', 'sse', 'auto']),
  status: z.enum(UPLOADABLE),
  error: z.string().max(2_000).nullable().optional(),
  snapshot: z
    .object({
      serverInfo: z
        .object({ name: z.string().max(256).nullable().optional(), version: z.string().max(100).nullable().optional() })
        .passthrough()
        .optional(),
      instructions: z.string().nullable().optional(),
      tools: z.array(z.unknown()).max(LIMITS.tools * 2),
      prompts: z.array(z.unknown()).max(LIMITS.prompts * 2).optional(),
      resourceTemplates: z.array(z.unknown()).max(LIMITS.resourceTemplates * 2).optional(),
      issues: z.array(z.unknown()).optional(),
    })
    .nullable()
    .optional(),
});

export const UploadSchema = z.object({
  source: z.enum(['cli', 'ci']).default('cli'),
  clientVersion: z.string().max(50).optional(),
  /** Offer published servers' contracts as public corroboration. */
  contribute: z.boolean().default(true),
  servers: z.array(z.unknown()).min(1).max(MAX_SERVERS_PER_UPLOAD),
});

export interface ParsedServer {
  alias: string;
  serverKey: string;
  configFingerprint: string;
  registry: (typeof REGISTRIES)[number];
  packageName: string | null;
  pinnedVersion: string | null;
  transport: string;
  status: ScanStatus;
  error: string | null;
  serverName: string | null;
  serverVersion: string | null;
  contract: {
    tools: McpTool[];
    prompts: PromptInfo[];
    resourceTemplates: ResourceTemplateInfo[];
    instructions: string | null;
    issues: SnapshotIssue[];
    contentHash: string;
    contractHash: string;
    bytes: number;
  } | null;
}

export interface Rejection {
  index: number;
  alias: string | null;
  reason: string;
}

/**
 * Validate and re-normalize an upload. Pure: no database, so every rule here is
 * unit-testable and the route can reject a bad body before opening a transaction.
 */
export function parseUpload(body: unknown): {
  servers: ParsedServer[];
  rejected: Rejection[];
  source: 'cli' | 'ci';
  contribute: boolean;
  error: string | null;
} {
  const top = UploadSchema.safeParse(body);
  if (!top.success) {
    return { servers: [], rejected: [], source: 'cli', contribute: false, error: top.error.issues[0]?.message ?? 'invalid upload' };
  }
  const servers: ParsedServer[] = [];
  const rejected: Rejection[] = [];
  const seen = new Set<string>();

  top.data.servers.forEach((raw, index) => {
    const alias = (raw as { alias?: unknown })?.alias;
    const reject = (reason: string) => rejected.push({ index, alias: typeof alias === 'string' ? alias.slice(0, 200) : null, reason });

    const parsed = ServerSchema.safeParse(raw);
    if (!parsed.success) return reject(parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '));
    const s = parsed.data;

    // Identity must be internally consistent, or one server could file its
    // history under another's key.
    const [prefix, ...rest] = s.serverKey.split(':');
    const keyName = rest.join(':');
    if (prefix !== s.registry || !keyName) return reject(`serverKey must start with "${s.registry}:"`);
    if ((s.registry === 'npm' || s.registry === 'pypi' || s.registry === 'docker') && keyName !== s.packageName) {
      return reject('serverKey does not match packageName');
    }
    const dedupe = `${s.serverKey}#${s.configFingerprint}`;
    if (seen.has(dedupe)) return reject('the same deployment appears twice in one upload');
    seen.add(dedupe);

    const readable = s.status === 'ok' || s.status === 'partial';
    if (readable && !s.snapshot) return reject(`status "${s.status}" requires a snapshot`);

    let contract: ParsedServer['contract'] = null;
    if (readable && s.snapshot) {
      // Redo the client's normalization with the same ceilings, then scrub.
      const issues: SnapshotIssue[] = [];
      const tools = new Map<string, McpTool>();
      const prompts = new Map<string, PromptInfo>();
      const templates = new Map<string, ResourceTemplateInfo>();
      addTools(s.snapshot.tools, tools, issues);
      addPrompts(s.snapshot.prompts ?? [], prompts, issues);
      addTemplates(s.snapshot.resourceTemplates ?? [], templates, issues);
      const clean = scrubDeep({
        tools: [...tools.values()],
        prompts: [...prompts.values()],
        resourceTemplates: [...templates.values()],
        instructions: s.snapshot.instructions ? s.snapshot.instructions.slice(0, LIMITS.instructions) : null,
      });
      const bytes = JSON.stringify(clean).length;
      if (bytes > MAX_CONTRACT_BYTES) return reject(`contract is ${bytes} bytes (limit ${MAX_CONTRACT_BYTES})`);
      contract = { ...clean, issues, contentHash: contentHash(clean), contractHash: contractHash(clean), bytes };
    }

    servers.push({
      alias: s.alias,
      serverKey: s.serverKey,
      configFingerprint: s.configFingerprint,
      registry: s.registry,
      packageName: s.packageName,
      pinnedVersion: s.pinnedVersion,
      transport: s.transport,
      status: s.status,
      error: s.error ? s.error.slice(0, 2_000) : null,
      serverName: s.snapshot?.serverInfo?.name ?? null,
      serverVersion: s.snapshot?.serverInfo?.version ?? null,
      contract,
    });
  });

  return { servers, rejected, source: top.data.source, contribute: top.data.contribute, error: null };
}

export interface IngestedServer {
  alias: string;
  serverKey: string;
  deploymentId: number;
  change: ChangeKind;
  worstSeverity: string | null;
  since: { at: string; severity: string; summary: string; rugPull: string[] } | null;
}

export interface IngestResult {
  servers: IngestedServer[];
  rejected: Rejection[];
}

/**
 * The version a public report is filed under, or null when we cannot be sure.
 *
 * A pinned version is the user's own statement. A handshake's self-reported
 * version is accepted only if it is valid semver; the quorum is what guards
 * against a server that lies about it consistently.
 */
function publicVersion(s: ParsedServer): string | null {
  if (s.pinnedVersion && semver.valid(s.pinnedVersion)) return s.pinnedVersion;
  if (s.serverVersion && semver.valid(s.serverVersion)) return s.serverVersion;
  return null;
}

async function contributePublic(db: Database, ownerId: string, s: ParsedServer): Promise<void> {
  if (!s.contract || s.status !== 'ok' || !s.packageName) return;
  if (s.registry !== 'npm' && s.registry !== 'pypi') return;
  const version = publicVersion(s);
  if (!version) return;

  const agree = await reportPublic(db, {
    registry: s.registry,
    packageName: s.packageName,
    version,
    contentHash: s.contract.contentHash,
    ownerId,
  });

  // The public graph is npm-keyed today; PyPI reports accumulate until it is not.
  if (s.registry !== 'npm') return;
  // Demand signal for the authoritative sandbox probe, whatever the quorum says.
  await enqueueSurface(db, s.packageName, version, 'mcp_server').catch(() => {});
  if (agree < PUBLIC_QUORUM) return;

  const existing = await loadStored(db, s.packageName, version, 0, 'mcp_server');
  if (existing && existing.rows.length > 0) return; // the probe (or an earlier quorum) already answered
  await storeSurface(db, mcpSurface(s.packageName, version, s.contract.tools), {
    artifactHash: s.contract.contractHash,
    extractorVersion: `crowd-${ANALYZER_VERSION}`,
    ref: mcpSurfaceRef(s.packageName, version),
    oracleId: 'mcp_server.crowd',
  });
  logger.info({ server: s.packageName, version, agree }, 'mcp: contract promoted to the public index by quorum');
}

export async function ingestScan(
  db: Database,
  ownerId: string,
  parsed: ReturnType<typeof parseUpload>,
): Promise<IngestResult> {
  const out: IngestResult = { servers: [], rejected: [...parsed.rejected] };
  let tracked = await countDeployments(db, ownerId);

  for (let i = 0; i < parsed.servers.length; i++) {
    const s = parsed.servers[i]!;
    try {
      if (tracked >= MAX_DEPLOYMENTS_PER_OWNER && !(await deploymentExists(db, ownerId, s.serverKey, s.configFingerprint))) {
        out.rejected.push({ index: i, alias: s.alias, reason: `this account already tracks ${MAX_DEPLOYMENTS_PER_OWNER} servers` });
        continue;
      }

      let worstSeverity = null;
      if (s.contract) {
        const analysis = analyzeServer(s.contract);
        worstSeverity = worst(analysis.findings);
        await putContract(db, {
          contentHash: s.contract.contentHash,
          contractHash: s.contract.contractHash,
          tools: s.contract.tools,
          prompts: s.contract.prompts,
          resourceTemplates: s.contract.resourceTemplates,
          instructions: s.contract.instructions,
          toolCount: s.contract.tools.length,
          bytes: s.contract.bytes,
          analysis,
          analyzerVersion: ANALYZER_VERSION,
        });
      }

      const res = await recordScan(
        db,
        {
          ownerId,
          serverKey: s.serverKey,
          configFingerprint: s.configFingerprint,
          alias: s.alias,
          registry: s.registry,
          packageName: s.packageName,
          transport: s.transport,
          serverName: s.serverName,
          serverVersion: s.serverVersion,
          status: s.status,
          error: s.error,
          contentHash: s.contract?.contentHash ?? null,
          worstSeverity,
          source: parsed.source,
        },
        (previous) =>
          diffSnapshots(
            {
              tools: previous.tools,
              prompts: previous.prompts,
              resourceTemplates: previous.resourceTemplates,
              instructions: previous.instructions,
            },
            {
              tools: s.contract!.tools,
              // A list that failed this scan is carried forward, never read as emptied.
              prompts: s.contract!.issues.some((x) => x.list === 'prompts' && x.kind === 'list_failed')
                ? previous.prompts
                : s.contract!.prompts,
              resourceTemplates: s.contract!.issues.some((x) => x.list === 'resourceTemplates' && x.kind === 'list_failed')
                ? previous.resourceTemplates
                : s.contract!.resourceTemplates,
              instructions: s.contract!.instructions,
            },
            s.alias,
          ),
      );
      if (res.change === 'first') tracked++;

      if (parsed.contribute) {
        // Corroboration is a side benefit; its failure must not fail the upload.
        await contributePublic(db, ownerId, s).catch((err) =>
          logger.warn({ server: s.serverKey, err: formatError(err) }, 'mcp: public report failed'),
        );
      }

      out.servers.push({
        alias: s.alias,
        serverKey: s.serverKey,
        deploymentId: res.deploymentId,
        change: res.change,
        worstSeverity,
        since: res.event
          ? { at: res.event.at.toISOString(), severity: res.event.severity, summary: res.event.summary, rugPull: res.event.rugPull }
          : null,
      });
    } catch (err) {
      logger.error({ server: s.serverKey, err: formatError(err) }, 'mcp: scan ingest failed');
      out.rejected.push({ index: i, alias: s.alias, reason: 'could not be recorded; try again' });
    }
  }
  return out;
}
