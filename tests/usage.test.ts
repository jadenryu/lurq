import { describe, expect, it } from 'vitest';
import ts from 'typescript';
import { loadCompiler, parseSurface } from '../src/usage/extract';
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
    const surface = parseSurface(dts, ts);
    const byName = Object.fromEntries(surface.map((s) => [s.name, s]));
    expect(byName.connect).toMatchObject({
      kind: 'function',
      signature: '(url: string, opts?: Options): Client',
    });
    expect(byName.Client?.kind).toBe('class');
    expect(byName.Options?.kind).toBe('interface');
    expect(byName.Handler?.kind).toBe('type');
    expect(byName.VERSION?.kind).toBe('variable');
    // Non-exported declarations are excluded.
    expect(byName.internalOnly).toBeUndefined();
  });

  it('loads the compiler lazily, so extraction works where it is installed', async () => {
    await expect(loadCompiler()).resolves.toBeTruthy();
  });

  // The shape rollup-plugin-dts and api-extractor emit (vite, helmet, and most
  // bundled types): everything is declared privately and exposed by one trailing
  // `export { … }`. `export` there is statement syntax, not a modifier.
  it('resolves a trailing export block against the local declarations', () => {
    const dts = `
      declare function createServer(opts?: Options): Server;
      declare const VERSION: string;
      interface Options { port: number }
      interface Secret { key: string }
      declare class Server {}
      export { createServer, Server, VERSION, Options, Server as ViteServer };
    `;
    const surface = parseSurface(dts, ts);
    const byName = Object.fromEntries(surface.map((s) => [s.name, s]));
    expect(byName.createServer).toMatchObject({
      kind: 'function',
      signature: '(opts?: Options): Server',
    });
    expect(byName.Server?.kind).toBe('class');
    expect(byName.VERSION?.kind).toBe('variable');
    expect(byName.Options?.kind).toBe('interface');
    // An alias is exported under its public name, keeping the local's kind.
    expect(byName.ViteServer?.kind).toBe('class');
    // Declared but never named by the export block — still private.
    expect(byName.Secret).toBeUndefined();
  });

  it('records re-exports, type-only exports and namespace exports', () => {
    const dts = `
      export { default as Redis, Cluster } from "./Redis";
      export type { RedisKey } from "./types";
      export * as helpers from "./helpers";
      interface Options { port: number }
      export type { Options };
    `;
    const surface = parseSurface(dts, ts);
    const byName = Object.fromEntries(surface.map((s) => [s.name, s]));
    // A re-export from another module: the name is real, the kind is unknowable
    // from this file alone.
    expect(byName.Redis).toMatchObject({ kind: 'unknown', signature: null });
    expect(byName.Cluster?.kind).toBe('unknown');
    expect(byName.RedisKey?.kind).toBe('type');
    expect(byName.helpers?.kind).toBe('namespace');
    // A local declaration beats the type-only default.
    expect(byName.Options?.kind).toBe('interface');
  });

  it('lifts the namespace behind a CommonJS `export =`', () => {
    const dts = `
      declare function e(): core.Express;
      declare namespace e {
        function json(options?: JsonOptions): RequestHandler;
        interface Request {}
        const raw: RequestHandler;
      }
      export = e;
    `;
    const surface = parseSurface(dts, ts);
    const byName = Object.fromEntries(surface.map((s) => [s.name, s]));
    // The namespace members ARE the public API, not properties of one symbol.
    expect(byName.json).toMatchObject({
      kind: 'function',
      signature: '(options?: JsonOptions): RequestHandler',
    });
    expect(byName.Request?.kind).toBe('interface');
    expect(byName.raw?.kind).toBe('variable');
    // The callable itself is what an importer binds by default.
    expect(byName.default).toMatchObject({ kind: 'function', signature: '(): core.Express' });
  });

  it('does not lift a namespace for an ESM default export', () => {
    const dts = `
      declare namespace z { const string: ZodString; }
      export default z;
    `;
    const byName = Object.fromEntries(parseSurface(dts, ts).map((s) => [s.name, s]));
    expect(byName.default?.kind).toBe('namespace');
    expect(byName.string).toBeUndefined();
  });
});

describe('diffSurface (§4D)', () => {
  const fn = (name: string, signature: string | null) => ({
    name,
    kind: 'function' as const,
    signature,
  });

  it('classifies added / removed / changed', () => {
    const oldS = [fn('a', '(): void'), fn('b', '(x: number): void')];
    const newS = [fn('a', '(): void'), fn('b', '(x: string): void'), fn('c', '(): void')];
    const d = diffSurface(oldS, newS);
    expect(d.added.map((s) => s.name)).toEqual(['c']);
    expect(d.removed).toHaveLength(0);
    expect(d.changed).toEqual([
      { name: 'b', before: '(x: number): void', after: '(x: string): void' },
    ]);
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
