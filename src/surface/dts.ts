/**
 * Tier C — bundled `.d.ts` (§6.2). SECONDARY, and type-level ONLY.
 *
 * This tier answers questions tier A structurally cannot: what is the full
 * signature, is it generic, is it overloaded, is it marked `@deprecated`. It is
 * the only source for `signature_changed` and for deprecation.
 *
 * It must NEVER answer "does this symbol exist at runtime". Declarations and
 * runtime are different artifacts that drift apart: `@types/*` is maintained by
 * strangers, and even a bundled `.d.ts` can declare exports the shipped JS does
 * not have. Removing a type breaks `tsc`; removing a runtime symbol breaks the
 * program. Conflating them is §6.4.4, and it forced 1,643 exclusions in the
 * study.
 *
 * Everything here is tagged `bundled_dts`, so §6.4.3's cross-tier guard refuses
 * to diff it against a tier-A surface.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join, relative, resolve as resolvePath, sep } from 'node:path';
import ts from 'typescript';
import { readManifest, resolveFile, type PackageManifest } from './resolve';
import type { ExtractedSurface, SurfaceSymbol, SymbolKind } from './types';

const TIER = 'bundled_dts' as const;

/** Walk an exports map for a "types" condition. */
function typesFromExports(exp: unknown, depth = 0): string | null {
  if (depth > 8 || !exp) return null;
  if (Array.isArray(exp)) {
    for (const e of exp) {
      const r = typesFromExports(e, depth + 1);
      if (r) return r;
    }
    return null;
  }
  if (typeof exp !== 'object') return null;
  const o = exp as Record<string, unknown>;
  if ('.' in o) return typesFromExports(o['.'], depth + 1);
  if (typeof o.types === 'string') return o.types;
  for (const cond of ['require', 'node', 'import', 'default']) {
    if (cond in o) {
      const r = typesFromExports(o[cond], depth + 1);
      if (r) return r;
    }
  }
  return null;
}

/** The declaration file a TypeScript consumer would load. */
export function resolveTypesEntry(
  pkgDir: string,
  manifest?: PackageManifest | null,
): string | null {
  const m = manifest ?? readManifest(pkgDir);
  if (!m) return null;

  const candidates: string[] = [];
  if (m.exports !== undefined) {
    const fromExports = typesFromExports(m.exports);
    if (fromExports) candidates.push(fromExports);
  }
  if (m.types) candidates.push(m.types);
  if (m.typings) candidates.push(m.typings);
  // Convention: index.d.ts, or the main entry with its extension swapped.
  if (m.main) candidates.push(m.main.replace(/\.(c|m)?js$/, '.d.ts'));
  candidates.push('./index.d.ts');

  for (const c of candidates) {
    const abs = resolvePath(pkgDir, c);
    if (existsSync(abs) && abs.endsWith('.d.ts')) return abs;
    const hit = resolveFile(abs.replace(/\.js$/, '.d.ts'));
    if (hit?.endsWith('.d.ts')) return hit;
    const dts = `${abs.replace(/\.d\.ts$|\.js$/, '')}.d.ts`;
    if (existsSync(dts)) return dts;
  }
  return null;
}


/**
 * Resolve an internal specifier to a declaration file.
 *
 * Declarations import with a `.js` extension but ship as `.d.ts` — TypeScript's
 * ESM convention — so `./v3/external.js` must find `./v3/external.d.ts`.
 */
function resolveDts(fromFile: string, spec: string, pkgDir: string): string | null {
  const root = resolvePath(pkgDir);
  const baseDir = resolvePath(fromFile, '..');
  const raw = resolvePath(baseDir, spec);
  if (raw !== root && !raw.startsWith(root + sep)) return null;
  const stripped = raw.replace(/\.(c|m)?js$/, '');
  for (const c of [`${stripped}.d.ts`, `${stripped}.d.mts`, `${stripped}.d.cts`,
                   join(stripped, 'index.d.ts'), raw]) {
    if (existsSync(c) && c.endsWith('.ts')) return c;
  }
  return null;
}

function hasDeprecated(sf: ts.SourceFile, node: ts.Node): boolean {
  const full = node.getFullText(sf);
  const lead = full.slice(0, full.length - node.getText(sf).length);
  return /@deprecated/i.test(lead);
}

/** One-line signature: the declaration text with the body and comments stripped. */
function signatureOf(sf: ts.SourceFile, node: ts.Node): string {
  let text = node.getText(sf);
  const brace = text.indexOf('{');
  if (brace > 0 && (ts.isFunctionDeclaration(node) || ts.isMethodSignature(node))) {
    text = text.slice(0, brace);
  }
  return text.replace(/\s+/g, ' ').trim().slice(0, 400);
}

function kindOfDecl(node: ts.Node): SymbolKind {
  if (ts.isFunctionDeclaration(node)) return 'function';
  if (ts.isClassDeclaration(node)) return 'class';
  if (ts.isInterfaceDeclaration(node) || ts.isTypeAliasDeclaration(node)) return 'type_only';
  if (ts.isEnumDeclaration(node)) return 'object';
  if (ts.isVariableStatement(node)) return 'object';
  return 'object';
}

function arityOfDecl(node: ts.Node): number | null {
  if (!ts.isFunctionDeclaration(node)) return null;
  let n = 0;
  for (const p of node.parameters) {
    if (p.initializer || p.dotDotDotToken || p.questionToken) break;
    n++;
  }
  return n;
}

/**
 * Extract the declared surface. Overloads collapse to one symbol whose signature
 * lists every overload, because an overload set is one callable name — reporting
 * three `foo` symbols would make a diff meaningless.
 */
export function extractTypeSurface(
  pkgDir: string,
  opts: { manifest?: PackageManifest | null } = {},
): ExtractedSurface {
  const manifest = opts.manifest ?? readManifest(pkgDir);
  const entry = resolveTypesEntry(pkgDir, manifest);
  const base: ExtractedSurface = {
    package: manifest?.name ?? pkgDir,
    version: manifest?.version ?? null,
    tier: TIER,
    entry: entry ? relative(pkgDir, entry) : null,
    symbols: [],
    filesWalked: 0,
    externalReExports: [],
  };
  if (!entry) return { ...base, undeclaredReason: 'package ships no .d.ts entry' };

  let text: string;
  try {
    text = readFileSync(entry, 'utf8');
  } catch {
    return { ...base, undeclaredReason: 'declaration file unreadable' };
  }
  const out = new Map<string, SurfaceSymbol>();
  const visited = new Set<string>();
  let filesWalked = 0;
  walkDts(entry, pkgDir, out, visited, () => filesWalked++);
  const symbols = [...out.values()].sort((a, b) => a.path.localeCompare(b.path));
  return {
    ...base,
    symbols,
    filesWalked,
    ...(symbols.length === 0
      ? { undeclaredReason: 'declaration file resolved but declares no exports' }
      : {}),
  };
}

/**
 * Walk a declaration file and everything it re-exports internally.
 *
 * §6.4.5 is not a tier-A-only defect: `zod`'s index.d.ts is a bare
 * `export * from "./v3/external.js"`, and a single-file scan returns 2 symbols
 * instead of the whole surface. Same fix, one tier up.
 */
function walkDts(
  entry: string,
  pkgDir: string,
  out: Map<string, SurfaceSymbol>,
  visited: Set<string>,
  onFile: () => void,
): void {
  if (visited.has(entry) || visited.size > 200) return;
  visited.add(entry);
  onFile();

  let text: string;
  try {
    text = readFileSync(entry, 'utf8');
  } catch {
    return;
  }
  const sf = ts.createSourceFile(entry, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const rel = relative(pkgDir, entry);

  const add = (name: string, node: ts.Node, kind?: SymbolKind) => {
    const existing = out.get(name);
    const sig = signatureOf(sf, node);
    if (existing) {
      // Overload set: append rather than overwrite.
      existing.signature = existing.signature ? `${existing.signature}; ${sig}` : sig;
      existing.deprecated = existing.deprecated || hasDeprecated(sf, node);
      return;
    }
    out.set(name, {
      path: name,
      kind: kind ?? kindOfDecl(node),
      arity: arityOfDecl(node),
      origin: 'local',
      deprecated: hasDeprecated(sf, node),
      tier: TIER,
      signature: sig,
      sourceRef: { file: rel, line: sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1 },
    });
  };

  for (const stmt of sf.statements) {
    const mods = ts.canHaveModifiers(stmt) ? ts.getModifiers(stmt) : undefined;
    const isExported = mods?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword);
    const isDefault = mods?.some((m) => m.kind === ts.SyntaxKind.DefaultKeyword);

    if (isExported) {
      if (ts.isVariableStatement(stmt)) {
        for (const d of stmt.declarationList.declarations) {
          if (ts.isIdentifier(d.name)) add(isDefault ? 'default' : d.name.text, d);
        }
      } else if (
        (ts.isFunctionDeclaration(stmt) ||
          ts.isClassDeclaration(stmt) ||
          ts.isInterfaceDeclaration(stmt) ||
          ts.isTypeAliasDeclaration(stmt) ||
          ts.isEnumDeclaration(stmt)) &&
        stmt.name
      ) {
        add(isDefault ? 'default' : stmt.name.text, stmt);
      }
      continue;
    }

    if (ts.isExportAssignment(stmt)) {
      add('default', stmt.expression);
      continue;
    }

    if (ts.isExportDeclaration(stmt)) {
      const spec =
        stmt.moduleSpecifier && ts.isStringLiteral(stmt.moduleSpecifier)
          ? stmt.moduleSpecifier.text
          : null;
      if (stmt.exportClause && ts.isNamedExports(stmt.exportClause)) {
        if (spec) {
          const target = resolveDts(entry, spec, pkgDir);
          if (target) {
            // Selective re-export: take only the named subset, honouring renames
            // — the same correctness rule as tier A.
            const sub = new Map<string, SurfaceSymbol>();
            walkDts(target, pkgDir, sub, new Set(visited), () => {});
            for (const el of stmt.exportClause.elements) {
              const from = el.propertyName?.text ?? el.name.text;
              const found = sub.get(from);
              if (found) {
                if (!out.has(el.name.text)) out.set(el.name.text, { ...found, path: el.name.text });
              } else {
                add(el.name.text, el, stmt.isTypeOnly || el.isTypeOnly ? 'type_only' : undefined);
              }
            }
          }
        } else {
          for (const el of stmt.exportClause.elements) {
            add(el.name.text, el, stmt.isTypeOnly || el.isTypeOnly ? 'type_only' : undefined);
          }
        }
      } else if (spec) {
        // `export * from` — the whole target surface is genuinely re-exported.
        const target = resolveDts(entry, spec, pkgDir);
        if (target) walkDts(target, pkgDir, out, visited, onFile);
      }
    }
  }
}

/** True when the package ships its own declarations (as opposed to @types/*). */
export function shipsOwnTypes(pkgDir: string): boolean {
  return resolveTypesEntry(pkgDir) !== null;
}

/** Convenience for callers holding a directory rather than a manifest. */
export function typesEntryPath(pkgDir: string): string | null {
  const e = resolveTypesEntry(pkgDir);
  return e ? join(pkgDir, relative(pkgDir, e)) : null;
}
