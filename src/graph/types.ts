/**
 * v2 graph primitives (docs/lurq-v2-spec.md §2–§4).
 *
 * The load-bearing idea is the Oracle Rule: a node type may enter the graph only
 * if you can name the command that verifies it and what failure looks like. That
 * is a function signature, and this file is it. Adding a node type means writing
 * an `Oracle` and registering it — nothing downstream (preflight, breaks_at,
 * private mode) needs to know which oracle produced an observation.
 *
 * This runs ALONGSIDE the v1 npm tables, deliberately. v1's package path is the
 * only thing with users; migrating it onto this model to prove the shape is the
 * highest-risk/lowest-information move available. Migrate after a second node
 * type has shown the abstraction holds.
 */
import type { Sandbox } from '../sandbox/types';

/** Node types. Extend only when the Oracle Rule is satisfiable for the new kind. */
export type EntityKind =
  | 'package_version'
  | 'mcp_server'
  | 'mcp_tool'
  | 'cli_surface'
  | 'http_endpoint';

/**
 * §4.1. The distinction between `verified_false` and `unknown` is the most
 * important thing in the API: an agent must always be able to tell "we checked
 * and it does not work" from "we have not checked".
 *
 * `unverifiable` must NEVER collapse into `verified_false` — an upstream rate
 * limit or a sandbox crash is not evidence about the subject. A single false
 * `verified_false` costs more trust than a hundred `unknown`s.
 */
export type Verdict =
  | 'verified_true'
  | 'verified_false'
  | 'unknown'
  | 'stale'
  | 'unverifiable';

/** Identity of a node, before it has a database id. */
export interface EntityRef {
  kind: EntityKind;
  /** Registry or authority: 'npm', 'api.stripe.com', … */
  namespace: string;
  name: string;
  /** Null for kinds that aren't versioned. */
  version?: string | null;
}

/** `kind:namespace:name:version` — the dedup key. */
export function canonicalKey(ref: EntityRef): string {
  return `${ref.kind}:${ref.namespace}:${ref.name}:${ref.version ?? ''}`;
}

/**
 * §2. `runtime_env` is deliberately not a verifiable node — it is a fingerprint
 * attached to every verdict. "Incompatible" is meaningless without it: the same
 * pair resolves cleanly on one runtime and fails on another.
 */
export interface Environment {
  os: string;
  arch: string;
  runtime: string;
  runtimeVer: string;
  /** 'npm@10', 'uv@0.5', … Null when the oracle doesn't resolve dependencies. */
  resolver?: string | null;
}

/** One fact an oracle established, plus the evidence that established it. */
export interface OracleObservation {
  /** Subject is implied by the oracle's target; object is set for binary claims. */
  object?: EntityRef;
  /** `resolves_with`, `provides`, `conflicts_with`, … (§3) */
  relation: string;
  verdict: Verdict;
  /** Exit code, stderr tail, schema diff — whatever makes the verdict auditable. */
  evidence?: string;
}

export interface OracleResult {
  observations: OracleObservation[];
  /** Child nodes discovered while verifying (e.g. the tools an MCP server lists). */
  discovered?: EntityRef[];
  costMillis: number;
}

/**
 * The Oracle Rule as a type. `run` must never throw for a subject-side failure —
 * that is a `verified_false` observation with evidence. Throw only when the
 * oracle itself could not run, and the caller records `unverifiable`.
 */
export interface Oracle<T extends EntityRef = EntityRef> {
  /** Stable id, e.g. 'mcp_server.handshake'. */
  readonly id: string;
  /** Bump when the oracle's semantics change; invalidates prior observations. */
  readonly version: string;
  readonly kind: EntityKind;
  /** Past this age an observation reads as `stale` (§4.1, applied at read time). */
  readonly ttlHours: number;
  /** One sentence: what we run, and what failure looks like. Enforced by review. */
  readonly rule: string;
  run(target: T, env: Environment, sandbox: Sandbox): Promise<OracleResult>;
}
