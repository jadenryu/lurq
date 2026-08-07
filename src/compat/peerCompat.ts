/**
 * Tier-1 compatibility: whole-architecture peer-dependency + engine analysis.
 *
 * Deterministic and instant — no install. Works over the *entire set* at once:
 * it collects every package's declared `peerDependencies`, groups them by peer,
 * and checks the declared semver ranges agree. Two plugins that need `eslint@8`
 * vs `eslint@9` conflict even if eslint isn't pinned in the set.
 *
 * Sparse data degrades safely: a package with no declared peers contributes no
 * constraints (which is correct — most packages declare none), so "not fully
 * recorded" never produces a false conflict. Genuinely-untracked packages are
 * reported as `unverified` by the caller, not guessed at.
 */
import semver from 'semver';
import type { CompatConflict, DependencyRanges, PeerMeta } from '../core/types';

export interface CompatMember {
  name: string;
  /** Pinned (latest) version, or null if unknown. */
  version: string | null;
  peerDependencies: DependencyRanges | null;
  peerDependenciesMeta: PeerMeta | null;
  engines: DependencyRanges | null;
}

interface PeerConstraint {
  requirer: string;
  peer: string;
  range: string;
  optional: boolean;
}

/** null = can't assert (invalid version/range). */
function satisfiesRange(version: string, range: string): boolean | null {
  if (!semver.validRange(range)) return null;
  const v = semver.valid(version) ? version : semver.coerce(version)?.version;
  if (!v) return null;
  return semver.satisfies(v, range, { includePrerelease: true });
}

function rangesIntersect(a: string, b: string): boolean | null {
  if (!semver.validRange(a) || !semver.validRange(b)) return null;
  try {
    return semver.intersects(a, b, { includePrerelease: true });
  } catch {
    return null;
  }
}

/** All peer/engine conflicts across the set (empty = no Tier-1 conflict found). */
export function resolveArchitectureCompat(members: CompatMember[]): CompatConflict[] {
  const conflicts: CompatConflict[] = [];
  const pinned = new Map<string, string>();
  for (const m of members) if (m.version) pinned.set(m.name, m.version);

  const constraints: PeerConstraint[] = [];
  for (const m of members) {
    if (!m.peerDependencies) continue;
    for (const [peer, range] of Object.entries(m.peerDependencies)) {
      constraints.push({
        requirer: m.name,
        peer,
        range,
        optional: Boolean(m.peerDependenciesMeta?.[peer]?.optional),
      });
    }
  }

  // (1) A peer that's pinned in the set must satisfy each declared range.
  for (const c of constraints) {
    const pv = pinned.get(c.peer);
    if (pv && satisfiesRange(pv, c.range) === false) {
      conflicts.push({
        source: 'peer-deps',
        packages: [c.requirer, c.peer],
        detail: `${c.requirer} needs peer ${c.peer}@${c.range}, but the stack uses ${c.peer}@${pv}`,
        requirement: { peer: c.peer, range: c.range, resolved: pv },
      });
    }
  }

  // (2) A peer required by ≥2 members but not pinned: their ranges must overlap.
  const byPeer = new Map<string, PeerConstraint[]>();
  for (const c of constraints) {
    if (pinned.has(c.peer) || c.optional) continue;
    const arr = byPeer.get(c.peer);
    if (arr) arr.push(c);
    else byPeer.set(c.peer, [c]);
  }
  for (const [peer, cs] of byPeer) {
    for (let i = 0; i < cs.length; i++) {
      for (let j = i + 1; j < cs.length; j++) {
        if (cs[i]!.range !== cs[j]!.range && rangesIntersect(cs[i]!.range, cs[j]!.range) === false) {
          conflicts.push({
            source: 'peer-deps',
            packages: [cs[i]!.requirer, cs[j]!.requirer],
            detail: `${cs[i]!.requirer} needs ${peer}@${cs[i]!.range} but ${cs[j]!.requirer} needs ${peer}@${cs[j]!.range} — no overlapping version`,
            // Two requirers disagreeing about a peer that isn't in the set: the
            // peer has no resolved version to report.
            requirement: { peer, range: cs[i]!.range, resolved: null },
          });
        }
      }
    }
  }

  // (3) Node engine ranges across the set must have a common solution.
  const nodeReqs = members
    .map((m) => ({ name: m.name, range: m.engines?.node }))
    .filter((r): r is { name: string; range: string } => typeof r.range === 'string');
  for (let i = 0; i < nodeReqs.length; i++) {
    for (let j = i + 1; j < nodeReqs.length; j++) {
      if (rangesIntersect(nodeReqs[i]!.range, nodeReqs[j]!.range) === false) {
        conflicts.push({
          source: 'engines',
          packages: [nodeReqs[i]!.name, nodeReqs[j]!.name],
          detail: `${nodeReqs[i]!.name} needs node ${nodeReqs[i]!.range} but ${nodeReqs[j]!.name} needs node ${nodeReqs[j]!.range} — no overlap`,
        });
      }
    }
  }

  return conflicts;
}

/**
 * Tier-1 check: each member's `engines.node` must satisfy the target runtime
 * (e.g. the benchmark / sandbox Node version). Sparse/missing engines are ignored.
 *
 * A bare major (`"20"`) means "some Node 20", not `20.0.0` — coercing it to the
 * .0.0 floor false-flagged every package with a modern engines floor (vite's
 * `^20.19.0 || >=22.12.0` "conflicted" with node 20). Partial versions are
 * therefore compared as *ranges* and only conflict when no Node in the target
 * line can satisfy the package; an exact version still gets an exact check.
 */
export function resolveRuntimeEngineConflicts(
  members: CompatMember[],
  nodeVersion: string,
): CompatConflict[] {
  const runtime = normalizeNodeVersion(nodeVersion);
  if (!runtime) return [];

  const conflicts: CompatConflict[] = [];
  for (const m of members) {
    const range = m.engines?.node;
    if (!range) continue;
    const ok = runtime.exact
      ? satisfiesRange(runtime.value, range)
      : rangesIntersect(runtime.value, range);
    if (ok === false) {
      conflicts.push({
        source: 'engines',
        packages: [m.name],
        detail: `${m.name}@${m.version ?? '?'} needs node ${range}, but the runtime is node ${runtime.label}`,
      });
    }
  }
  return conflicts;
}

/** The target runtime as a semver *range*, plus whether the caller pinned an
 *  exact version. `20` / `v20` → `20.x` (any Node 20); `20.20.2` → exact. */
interface TargetRuntime {
  /** Exact version, or a range covering the requested line. */
  value: string;
  exact: boolean;
  /** What the caller asked for, for the conflict message. */
  label: string;
}

export function normalizeNodeVersion(raw: string): TargetRuntime | null {
  const trimmed = raw.trim().replace(/^v/i, '');
  if (!trimmed) return null;
  if (semver.valid(trimmed)) return { value: trimmed, exact: true, label: trimmed };
  // `20` or `20.19` — a version line, not a version. Widen to the whole line.
  if (/^\d+(\.\d+)?$/.test(trimmed)) {
    return { value: `${trimmed}.x`, exact: false, label: trimmed };
  }
  const coerced = semver.coerce(trimmed);
  return coerced ? { value: coerced.version, exact: true, label: coerced.version } : null;
}
