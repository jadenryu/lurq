/**
 * API surface extraction (§4D — usage axis D1). Ground truth is the package's
 * shipped `.d.ts`, parsed deterministically (no LLM) into a normalized export
 * list. Types are the code's real contract, extracted from the *exact* version —
 * no prose lag, no hallucination surface.
 *
 * We fetch the resolved types entry directly from the jsDelivr CDN rather than
 * download + untar the tarball: a single-file *syntactic* parse (createSourceFile,
 * no type-checker, no module resolution) captures top-level export presence and
 * signatures — the dominant drift class — without pulling the whole dep graph or
 * adding a `tar` dependency.
 *
 * ponytail: covers `types`/`typings`/`index.d.ts`, and only what that ONE file
 * declares. Three shapes still degrade to null → `usage` falls back to the README:
 *   - no shipped types, types living in `@types/*` instead (react, express, semver)
 *   - types reachable only through an `exports` map (vite, helmet)
 *   - a barrel entry that re-exports rather than declares — `export * from './lib'`
 *     (zod, drizzle-orm), since a single-file parse can't follow the specifier
 * Measured on a 12-package popular-library sample, 5 extract. That was invisible
 * while extraction was worker-only; now that a miss extracts on the request path
 * it sets the ceiling on how often `usage` can answer. Upgrade paths, in value
 * order: follow `export *` one hop, read the `exports` types condition, then fall
 * back to `@types/<name>`.
 *
 * The compiler is loaded LAZILY and non-fatally, and that is load-bearing for the
 * plane split (§4E): `typescript` is a devDependency, present in the operator
 * runtime but never installed for consumers of the published package (which ships
 * `dist` only). A static `import ts from 'typescript'` here is hoisted by esbuild
 * into a top-level import of the public bundle, so every `lurqrun` command — not
 * just `usage` — would die at startup with ERR_MODULE_NOT_FOUND. Deferring the
 * import to the first extraction keeps it out of the bundle's static graph, and a
 * compiler that won't load degrades to null exactly like an untyped package.
 */
import type * as TSApi from 'typescript';
import { httpRequest } from '../core/http';
import { CACHE_TTL } from '../core/constants';
import type { ExportKind, ExportSymbol } from '../core/types';

/** The compiler module itself, threaded through the parse helpers as a value so
 *  nothing in this file references `typescript` at module scope. */
type Compiler = typeof TSApi;

const CDN = 'cdn.jsdelivr.net';

/** HTTP tuning for the two CDN fetches. The read path passes a tighter budget
 *  than the worker: on the serving path a slow CDN must not hold a request open
 *  for the default 15s × 4 attempts. */
export interface ExtractOptions {
  timeoutMs?: number;
  retries?: number;
}

let compiler: Promise<Compiler | null> | undefined;

/**
 * Load `typescript` once per process, resolving null when it isn't installed.
 * Memoized on the promise so concurrent cold misses share one module load, and
 * so a missing compiler is only probed once.
 */
export function loadCompiler(): Promise<Compiler | null> {
  compiler ??= import('typescript')
    .then((m) => ((m as { default?: Compiler }).default ?? (m as unknown as Compiler)))
    .catch(() => null);
  return compiler;
}

async function fetchText(url: string, opts: ExtractOptions): Promise<string | null> {
  try {
    const { data } = await httpRequest<string>(url, {
      host: CDN,
      ttlMs: CACHE_TTL.depsDev, // versions are immutable; a long TTL is safe
      accept: 'text',
      ...(opts.timeoutMs !== undefined ? { timeoutMs: opts.timeoutMs } : {}),
      ...(opts.retries !== undefined ? { retries: opts.retries } : {}),
    });
    return typeof data === 'string' ? data : null;
  } catch {
    return null;
  }
}

/** Resolve the `.d.ts` entry path from the version's package.json `types`/`typings`. */
async function resolveTypesEntry(
  name: string,
  version: string,
  opts: ExtractOptions,
): Promise<string | null> {
  const pkgJson = await fetchText(`https://${CDN}/npm/${name}@${version}/package.json`, opts);
  if (!pkgJson) return null;
  try {
    const manifest = JSON.parse(pkgJson);
    const entry: unknown = manifest.types ?? manifest.typings;
    if (typeof entry === 'string') return entry.replace(/^\.?\//, '');
  } catch {
    /* fall through to the default */
  }
  return 'index.d.ts';
}

function kindOf(ts: Compiler, node: TSApi.Node): ExportKind {
  if (ts.isFunctionDeclaration(node)) return 'function';
  if (ts.isClassDeclaration(node)) return 'class';
  if (ts.isInterfaceDeclaration(node)) return 'interface';
  if (ts.isTypeAliasDeclaration(node)) return 'type';
  if (ts.isEnumDeclaration(node)) return 'enum';
  if (ts.isModuleDeclaration(node)) return 'namespace';
  if (ts.isVariableStatement(node)) return 'variable';
  return 'unknown';
}

/** Collapse whitespace so signatures compare cleanly across formatting changes. */
function normalize(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

/** A function's `(params): return` signature; other kinds keep their head line. */
function signatureOf(ts: Compiler, node: TSApi.Node, src: TSApi.SourceFile): string | null {
  if (ts.isFunctionDeclaration(node)) {
    const params = node.parameters.map((p) => normalize(p.getText(src))).join(', ');
    const ret = node.type ? `: ${normalize(node.type.getText(src))}` : '';
    return `(${params})${ret}`;
  }
  if (ts.isTypeAliasDeclaration(node)) return normalize(node.type.getText(src));
  // For classes/interfaces/enums the name+kind is the stable contract; a full
  // body diff is noisy. Keep null so `changed` only fires on real signature drift.
  return null;
}

function hasExportModifier(ts: Compiler, node: TSApi.Node): boolean {
  return (
    ts.canHaveModifiers(node) &&
    (ts.getModifiers(node)?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword) ?? false)
  );
}

/** Parse `.d.ts` text into a normalized, name-sorted export surface. The compiler
 *  is passed in (see `loadCompiler`) rather than imported at module scope. */
export function parseSurface(source: string, ts: Compiler): ExportSymbol[] {
  const src = ts.createSourceFile('surface.d.ts', source, ts.ScriptTarget.Latest, true);
  const out = new Map<string, ExportSymbol>();

  const add = (name: string, kind: ExportKind, signature: string | null) => {
    if (!out.has(name)) out.set(name, { name, kind, signature });
  };

  for (const node of src.statements) {
    if (!hasExportModifier(ts, node)) continue;

    if (ts.isVariableStatement(node)) {
      for (const decl of node.declarationList.declarations) {
        if (ts.isIdentifier(decl.name)) {
          add(decl.name.text, 'variable', decl.type ? normalize(decl.type.getText(src)) : null);
        }
      }
      continue;
    }

    // export { a, b as c } — re-exports; record the exported (outer) name.
    if (ts.isExportDeclaration(node) && node.exportClause && ts.isNamedExports(node.exportClause)) {
      for (const el of node.exportClause.elements) add(el.name.text, 'unknown', null);
      continue;
    }

    const named = node as TSApi.DeclarationStatement;
    if (named.name && ts.isIdentifier(named.name)) {
      add(named.name.text, kindOf(ts, node), signatureOf(ts, node, src));
    }
  }

  return [...out.values()].sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Extract the public API surface for `name@version`, or null if types can't be
 * resolved. Deterministic and cache-forever (versions are immutable).
 *
 * The compiler is resolved *before* the CDN fetches so a runtime without
 * `typescript` costs nothing but the (memoized) failed import.
 */
export async function extractSurface(
  name: string,
  version: string,
  opts: ExtractOptions = {},
): Promise<ExportSymbol[] | null> {
  const ts = await loadCompiler();
  if (!ts) return null;
  const entry = await resolveTypesEntry(name, version, opts);
  if (!entry) return null;
  const dts = await fetchText(`https://${CDN}/npm/${name}@${version}/${entry}`, opts);
  if (!dts) return null;
  const surface = parseSurface(dts, ts);
  return surface.length > 0 ? surface : null;
}
