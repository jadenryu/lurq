/**
 * Oracle runner: resolve the environment, run the oracle, record observations.
 *
 * The one rule this file enforces, from spec §6.1: an oracle that THROWS did not
 * observe anything about its subject — that is infrastructure failure, recorded
 * as `unverifiable` and requeued, never as `verified_false`. A single false
 * negative costs more trust than a hundred `unknown`s.
 */
import type { Database } from '../db/client';
import {
  recordObservation,
  upsertClaim,
  upsertEntity,
  upsertEnvironment,
} from '../db/graph';
import { getSandbox } from '../sandbox/index';
import type { Sandbox } from '../sandbox/types';
import { mcpServerOracle } from './oracles/mcpServer';
import type { Environment, EntityKind, EntityRef, Oracle } from './types';

/** Every oracle in the graph, by node kind. Adding a node type = adding a row. */
export const ORACLES: Partial<Record<EntityKind, Oracle>> = {
  mcp_server: mcpServerOracle,
};

export interface RunOracleResult {
  target: EntityRef;
  observations: number;
  discovered: number;
  verdicts: string[];
  costMillis: number;
}

/** Describe the sandbox's runtime as an environment fingerprint (§2). */
async function describeEnvironment(sandbox: Sandbox): Promise<Environment> {
  const { nodeVersion, npmVersion } = await sandbox.getRuntimeInfo();
  return {
    os: process.platform,
    arch: process.arch,
    runtime: 'node',
    runtimeVer: nodeVersion.replace(/^v/, ''),
    resolver: npmVersion === 'unknown' ? null : `npm@${npmVersion}`,
  };
}

export async function runOracle(
  db: Database,
  target: EntityRef,
  opts: { sandbox?: Sandbox; tenantId?: number } = {},
): Promise<RunOracleResult> {
  const oracle = ORACLES[target.kind];
  if (!oracle) throw new Error(`No oracle registered for kind '${target.kind}'`);

  const sandbox = opts.sandbox ?? (await getSandbox());
  const tenantId = opts.tenantId ?? 0;
  const env = await describeEnvironment(sandbox);
  const envRow = await upsertEnvironment(db, env);
  const subject = await upsertEntity(db, target, tenantId);

  let result;
  try {
    result = await oracle.run(target, env, sandbox);
  } catch (err) {
    // Infrastructure failed, not the subject. Record it as such so the entity
    // stays visibly untested rather than silently condemned.
    const claim = await upsertClaim(db, {
      subjectId: subject.id,
      relation: 'initializes',
      environmentId: envRow.id,
      tenantId,
    });
    await recordObservation(db, {
      claimId: claim.id,
      verdict: 'unverifiable',
      evidence: String(err).slice(0, 500),
      oracleId: oracle.id,
      oracleVer: oracle.version,
    });
    return {
      target,
      observations: 1,
      discovered: 0,
      verdicts: ['unverifiable'],
      costMillis: 0,
    };
  }

  const verdicts: string[] = [];
  for (const obs of result.observations) {
    const objectRow = obs.object ? await upsertEntity(db, obs.object, tenantId) : null;
    const claim = await upsertClaim(db, {
      subjectId: subject.id,
      objectId: objectRow?.id ?? null,
      relation: obs.relation,
      environmentId: envRow.id,
      tenantId,
    });
    await recordObservation(db, {
      claimId: claim.id,
      verdict: obs.verdict,
      evidence: obs.evidence,
      oracleId: oracle.id,
      oracleVer: oracle.version,
      costMillis: result.costMillis,
    });
    verdicts.push(obs.verdict);
  }

  // Children discovered during verification (e.g. an MCP server's tools) are
  // registered as entities so they can be queried and later verified in their
  // own right. The `provides` observations above already link them.
  for (const ref of result.discovered ?? []) {
    await upsertEntity(db, ref, tenantId);
  }

  return {
    target,
    observations: result.observations.length,
    discovered: result.discovered?.length ?? 0,
    verdicts,
    costMillis: result.costMillis,
  };
}
