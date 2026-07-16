import { describe, expect, it } from 'vitest';
import { parseSurface } from '../src/usage/extract';
import { diffSurface } from '../src/usage/diff';

describe('parseSurface (§4D)', () => {
  it('extracts exported symbols with kinds and function signatures', () => {
    const dts = `
      export function connect(url: string, opts?: Options): Client;
      export class Client {}
      export interface Options { timeout: number }
      export type Handler = (req: Request) => void;
      export const VERSION: string;
      declare function internalOnly(): void;
    `;
    const surface = parseSurface(dts);
    const byName = Object.fromEntries(surface.map((s) => [s.name, s]));
    expect(byName.connect).toMatchObject({ kind: 'function', signature: '(url: string, opts?: Options): Client' });
    expect(byName.Client?.kind).toBe('class');
    expect(byName.Options?.kind).toBe('interface');
    expect(byName.Handler?.kind).toBe('type');
    expect(byName.VERSION?.kind).toBe('variable');
    // Non-exported declarations are excluded.
    expect(byName.internalOnly).toBeUndefined();
  });
});

describe('diffSurface (§4D)', () => {
  const fn = (name: string, signature: string | null) => ({ name, kind: 'function' as const, signature });

  it('classifies added / removed / changed', () => {
    const oldS = [fn('a', '(): void'), fn('b', '(x: number): void')];
    const newS = [fn('a', '(): void'), fn('b', '(x: string): void'), fn('c', '(): void')];
    const d = diffSurface(oldS, newS);
    expect(d.added.map((s) => s.name)).toEqual(['c']);
    expect(d.removed).toHaveLength(0);
    expect(d.changed).toEqual([{ name: 'b', before: '(x: number): void', after: '(x: string): void' }]);
  });

  it('infers a rename from an identical signature disappearing and reappearing', () => {
    const oldS = [fn('makeClient', '(url: string): Client')];
    const newS = [fn('createClient', '(url: string): Client')];
    const d = diffSurface(oldS, newS);
    expect(d.renamed).toEqual([{ from: oldS[0], to: newS[0] }]);
    // A rename is not double-counted as add + remove.
    expect(d.added).toHaveLength(0);
    expect(d.removed).toHaveLength(0);
  });
});
