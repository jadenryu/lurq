/**
 * Read/write helpers for the v2 graph (entities / environments / claims /
 * observations). See docs/lurq-v2-spec.md §5.
 *
 * The only invariant that matters here: `observations` is APPEND-ONLY. Nothing
 * in this file updates a verdict, and nothing should ever be added that does —
 * `breaks_at` is derived by scanning the history, so overwriting destroys the
 * product. `stale` is computed at read time from the oracle's TTL.
 */
import { and, eq, isNull } from 'drizzle-orm';
import { createHash } from 'node:crypto';
import type { Database } from './client';
import { claims, entities, environments, observations } from './schema';
import type { ClaimRow, EntityRow, EnvironmentRow } from './schema';
import {
  canonicalKey,
  type Environment,
  type EntityRef,
  type EvidenceClass,
  type Verdict,
} from '../graph/types';
import type { ExtractionTier } from '../surface/types';

/** Stable hash of the runtime dimensions — the environment dedup key. */
export function fingerprint(env: Environment): string {
  const parts = [env.os, env.arch, env.runtime, env.runtimeVer, env.resolver ?? ''];
  return createHash('sha256').update(parts.join('\0')).digest('hex').slice(0, 32);
}

export async function upsertEnvironment(db: Database, env: Environment): Promise<EnvironmentRow> {
  const fp = fingerprint(env);
  const [row] = await db
    .insert(environments)
    .values({ ...env, resolver: env.resolver ?? null, fingerprint: fp })
    .onConflictDoUpdate({
      target: environments.fingerprint,
      // No-op update so the RETURNING clause yields the existing row.
      set: { fingerprint: fp },
    })
    .returning();
  return row!;
}

export async function upsertEntity(
  db: Database,
  ref: EntityRef,
  tenantId = 0,
): Promise<EntityRow> {
  const key = canonicalKey(ref);
  const [row] = await db
    .insert(entities)
    .values({
      kind: ref.kind,
      namespace: ref.namespace,
      name: ref.name,
      version: ref.version ?? null,
      canonicalKey: key,
      tenantId,
    })
    .onConflictDoUpdate({
      target: [entities.canonicalKey, entities.tenantId],
      set: { canonicalKey: key },
    })
    .returning();
  return row!;
}

export async function upsertClaim(
  db: Database,
  args: {
    subjectId: number;
    objectId?: number | null;
    relation: string;
    /** Null for declared claims — they hold in every environment (§5). */
    environmentId?: number | null;
    tenantId?: number;
  },
): Promise<ClaimRow> {
  const objectId = args.objectId ?? null;
  const envId = args.environmentId ?? null;
  const tenantId = args.tenantId ?? 0;
  const existing = await db
    .select()
    .from(claims)
    .where(
      and(
        eq(claims.subjectId, args.subjectId),
        objectId === null ? isNull(claims.objectId) : eq(claims.objectId, objectId),
        eq(claims.relation, args.relation),
        envId === null ? isNull(claims.environmentId) : eq(claims.environmentId, envId),
        eq(claims.tenantId, tenantId),
      ),
    )
    .limit(1);
  if (existing[0]) return existing[0];

  // The unique index can't dedup NULL object_id or environment_id (Postgres
  // treats NULLs as distinct), so the select above is the real guard and this
  // insert races benignly: a duplicate claim costs one redundant row, never a
  // wrong verdict. Fully-populated tuples are protected by the index.
  const [row] = await db
    .insert(claims)
    .values({ subjectId: args.subjectId, objectId, relation: args.relation, environmentId: envId, tenantId })
    .returning();
  return row!;
}

export async function recordObservation(
  db: Database,
  args: {
    claimId: number;
    verdict: Verdict;
    /** What kind of evidence backs it (§4.1). Defaults to executed for oracles. */
    class?: EvidenceClass;
    /** Extraction tier, for declared claims; null for executed ones (§6.2). */
    tier?: ExtractionTier | null;
    evidence?: string | null;
    oracleId: string;
    oracleVer: string;
    costMillis?: number | null;
  },
): Promise<void> {
  await db.insert(observations).values({
    claimId: args.claimId,
    verdict: args.verdict,
    class: args.class ?? 'executed',
    tier: args.tier ?? null,
    evidence: args.evidence ?? null,
    oracleId: args.oracleId,
    oracleVer: args.oracleVer,
    costMillis: args.costMillis ?? null,
  });
}

/**
 * §4.1, applied at READ time — never written by a background job.
 *
 * A verdict past its oracle's TTL reads as `stale`, never as its original value.
 * `unknown` never goes stale (there is nothing to expire), and it must stay
 * distinguishable from `verified_false`: "we have not checked" is a different
 * answer from "we checked and it does not work".
 */
export function applyTtl(
  verdict: Verdict,
  observedAt: Date,
  ttlHours: number,
  now = Date.now(),
): Verdict {
  if (verdict === 'unknown' || verdict === 'unverifiable' || verdict === 'undeclared')
    return verdict;
  const ageHours = (now - observedAt.getTime()) / 3_600_000;
  return ageHours > ttlHours ? 'stale' : verdict;
}
