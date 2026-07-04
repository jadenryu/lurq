/**
 * Typosquat detection.
 *
 * A package whose name is a near-miss of a popular one (`crossenv` for
 * `cross-env`, `expres` for `express`) is the classic supply-chain attack: a
 * coding agent fat-fingers or hallucinates a name and installs the impostor.
 * We compare a queried name against the most-downloaded packages lurq already
 * tracks — a tiny edit distance to a popular name the package itself is NOT is
 * a strong signal.
 */
import popularPackages from '../data/popular-packages.json';

/** Static baseline of well-known npm names. Unioned with the tracked corpus so
 *  detection still works on a cold/thin index (fresh deploy, few syncs) and
 *  catches squats of famous packages that aren't tracked yet. */
const POPULAR_BASELINE = popularPackages as string[];

/** Tracked top-downloads names + the static baseline, de-duplicated. Pass the
 *  result as the corpus to `detectTyposquat` so the guard is never silently off. */
export function typosquatCorpus(trackedTopNames: string[]): string[] {
  return [...new Set([...POPULAR_BASELINE, ...trackedTopNames])];
}

/** `@scope/name` → `name` so scope decoration doesn't dominate the distance. */
function bareName(name: string): string {
  const slash = name.indexOf('/');
  return (slash >= 0 ? name.slice(slash + 1) : name).toLowerCase();
}

/**
 * Damerau-Levenshtein (optimal string alignment) edit distance — counts
 * insertions, deletions, substitutions, and adjacent transpositions.
 */
export function editDistance(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;

  // Rolling rows: prevPrev enables the adjacent-transposition check.
  let prevPrev = new Array<number>(n + 1).fill(0);
  let prev = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    const cur = new Array<number>(n + 1).fill(0);
    cur[0] = i;
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let val = Math.min(
        (prev[j] ?? 0) + 1,
        (cur[j - 1] ?? 0) + 1,
        (prev[j - 1] ?? 0) + cost,
      );
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        val = Math.min(val, (prevPrev[j - 2] ?? 0) + 1);
      }
      cur[j] = val;
    }
    prevPrev = prev;
    prev = cur;
  }
  return prev[n] ?? 0;
}

export type TyposquatHit = { target: string; distance: number };

/**
 * Closest popular package within `maxDistance` edits, or null. The queried name
 * being popular itself is never a hit. Names shorter than 4 chars are skipped —
 * at that length a single edit is noise, not an attack signal.
 */
export function detectTyposquat(
  name: string,
  popular: readonly string[],
  maxDistance = 2,
): TyposquatHit | null {
  const target = bareName(name);
  if (target.length < 4) return null;
  if (popular.some((p) => p.toLowerCase() === name.toLowerCase())) return null;

  let best: TyposquatHit | null = null;
  for (const p of popular) {
    const cand = bareName(p);
    if (cand === target) continue; // same bare name (e.g. a fork under a scope)
    if (Math.abs(cand.length - target.length) > maxDistance) continue; // can't be close
    const dist = editDistance(target, cand);
    if (dist >= 1 && dist <= maxDistance && (!best || dist < best.distance)) {
      best = { target: p, distance: dist };
      if (dist === 1) break; // nothing closer is possible
    }
  }
  return best;
}
