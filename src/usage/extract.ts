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
 * ponytail: covers `types`/`typings`/`index.d.ts`. Packages that expose types
 * only through an `exports` map, or ship no types, degrade to null → `usage`
 * falls back to the README. Upgrade path: read the `exports` types condition.
 */
import ts from 'typescript';
import { httpRequest } from '../core/http';
import { CACHE_TTL } from '../core/constants';
import type { ExportKind, ExportSymbol } from '../core/types';

const CDN = 'cdn.jsdelivr.net';

async function fetchText(url: string): Promise<string | null> {
  try {
    const { data } = await httpRequest<string>(url, {
      host: CDN,
      ttlMs: CACHE_TTL.depsDev, // versions are immutable; a long TTL is safe
      accept: 'text',
    });
    return typeof data === 'string' ? data : null;
  } catch {
    return null;
  }
}

/** Resolve the `.d.ts` entry path from the version's package.json `types`/`typings`. */
async function resolveTypesEntry(name: string, version: string): Promise<string | null> {
  const pkgJson = await fetchText(`https://${CDN}/npm/${name}@${version}/package.json`);
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

function kindOf(node: ts.Node): ExportKind {
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
function signatureOf(node: ts.Node, src: ts.SourceFile): string | null {
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

function hasExportModifier(node: ts.Node): boolean {
  return (
    ts.canHaveModifiers(node) &&
    (ts.getModifiers(node)?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword) ?? false)
  );
}

/** Parse `.d.ts` text into a normalized, name-sorted export surface. */
export function parseSurface(source: string): ExportSymbol[] {
  const src = ts.createSourceFile('surface.d.ts', source, ts.ScriptTarget.Latest, true);
  const out = new Map<string, ExportSymbol>();

  const add = (name: string, kind: ExportKind, signature: string | null) => {
    if (!out.has(name)) out.set(name, { name, kind, signature });
  };

  for (const node of src.statements) {
    if (!hasExportModifier(node)) continue;

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

    const named = node as ts.DeclarationStatement;
    if (named.name && ts.isIdentifier(named.name)) {
      add(named.name.text, kindOf(node), signatureOf(node, src));
    }
  }

  return [...out.values()].sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Extract the public API surface for `name@version`, or null if types can't be
 * resolved. Deterministic and cache-forever (versions are immutable).
 */
export async function extractSurface(name: string, version: string): Promise<ExportSymbol[] | null> {
  const entry = await resolveTypesEntry(name, version);
  if (!entry) return null;
  const dts = await fetchText(`https://${CDN}/npm/${name}@${version}/${entry}`);
  if (!dts) return null;
  const surface = parseSurface(dts);
  return surface.length > 0 ? surface : null;
}
