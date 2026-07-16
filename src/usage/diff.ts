/**
 * Surface delta (§4D). Pure: given two extracted API surfaces, compute what an
 * agent must change — added / removed / renamed / changed exports. Deltas are
 * computed, not guessed. `renamed` is inferred when a symbol disappears and a
 * near-identical one (same kind + signature) appears, so an agent sees a rename
 * rather than an unrelated remove + add.
 */
import type { ExportSymbol, SurfaceDelta } from '../core/types';

function byName(surface: ExportSymbol[]): Map<string, ExportSymbol> {
  return new Map(surface.map((s) => [s.name, s]));
}

/** Two removed/added symbols are the "same" renamed export if kind + signature
 *  match (signature-similarity heuristic from §4D). */
function looksRenamed(a: ExportSymbol, b: ExportSymbol): boolean {
  return a.kind === b.kind && a.signature !== null && a.signature === b.signature;
}

export function diffSurface(oldSurface: ExportSymbol[], newSurface: ExportSymbol[]): SurfaceDelta {
  const oldByName = byName(oldSurface);
  const newByName = byName(newSurface);

  const removed: ExportSymbol[] = oldSurface.filter((s) => !newByName.has(s.name));
  const added: ExportSymbol[] = newSurface.filter((s) => !oldByName.has(s.name));
  const changed: SurfaceDelta['changed'] = [];

  for (const oldSym of oldSurface) {
    const newSym = newByName.get(oldSym.name);
    if (newSym && oldSym.signature !== newSym.signature) {
      changed.push({ name: oldSym.name, before: oldSym.signature, after: newSym.signature });
    }
  }

  // Pair removed↔added by signature similarity → renames. Each side used once.
  const renamed: SurfaceDelta['renamed'] = [];
  const takenAdded = new Set<string>();
  const stillRemoved: ExportSymbol[] = [];
  for (const r of removed) {
    const match = added.find((a) => !takenAdded.has(a.name) && looksRenamed(r, a));
    if (match) {
      renamed.push({ from: r, to: match });
      takenAdded.add(match.name);
    } else {
      stillRemoved.push(r);
    }
  }

  return {
    added: added.filter((a) => !takenAdded.has(a.name)),
    removed: stillRemoved,
    renamed,
    changed,
  };
}
