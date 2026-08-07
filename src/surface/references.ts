/**
 * Reference scanner (§9.1) — what symbols does this codebase actually use from
 * each dependency, and at which file:line.
 *
 * This is the half of `check_upgrade` that makes the check COVERAGE-INDEPENDENT,
 * and it is the whole wedge: Renovate and Dependabot gate an upgrade on your test
 * suite, so an uncovered path merges green and breaks later. Comparing what the
 * code *references* against what the target version *exports* needs no tests at
 * all.
 *
 * Static and conservative by construction. It resolves what an import binds and
 * which properties are read off it; it does not attempt dynamic access
 * (`pkg[name]`), which is reported nowhere rather than guessed at — a false
 * "you use this" is a false blocking result, and a CI check that cries wolf gets
 * disabled inside two weeks (§12 M3's kill condition).
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { extname, join, relative } from 'node:path';
import ts from 'typescript';

const SOURCE_EXT = new Set(['.ts', '.tsx', '.mts', '.cts', '.js', '.jsx', '.mjs', '.cjs']);
const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'build', 'out', '.next', 'coverage']);

/**
 * How the symbol was reached — which decides whether it is a claim about the
 * MODULE'S EXPORT SURFACE or about a property of an exported value.
 *
 *   named / destructured / namespace  → a real export claim; tier A can verify
 *   default                           → the module itself
 *   default-member                    → a property of the default export's VALUE
 *
 * The last one is the important distinction. `chalk.bold` is correct chalk usage
 * but `bold` is not a module export, so scoring it against a tier-A surface
 * reports a miss on working code. Doing that in check_upgrade would block a PR
 * on valid code, which is how a CI gate gets switched off (§12 M3).
 */
export type ReferenceVia =
  | 'named'
  | 'destructured'
  | 'namespace'
  | 'default'
  | 'default-member'
  /** Erased by TypeScript before runtime — never a runtime-surface claim. */
  | 'type-only';

export interface SymbolReference {
  /** Exported name used from the package. 'default' for a default import. */
  symbol: string;
  via: ReferenceVia;
  /**
   * The full import specifier. A subpath (`drizzle-orm/pg-core`) has its OWN
   * entry point and its own surface — scoring its symbols against the package
   * ROOT reports every one of them missing, on correct code.
   */
  specifier: string;
  file: string;
  line: number;
}

/** Kinds that assert something about the module's own export surface. */
export const SURFACE_CLAIM_KINDS: ReferenceVia[] = ['named', 'destructured', 'namespace'];

/** True when the reference is against the package root rather than a subpath. */
export function isRootSpecifier(ref: SymbolReference, pkg: string): boolean {
  return ref.specifier === pkg;
}

export interface PackageReferences {
  package: string;
  symbols: Map<string, SymbolReference[]>;
}

/** Bare specifier → package name (`@scope/pkg/sub` → `@scope/pkg`). */
export function packageOfSpecifier(spec: string): string | null {
  if (!spec || spec.startsWith('.') || spec.startsWith('/')) return null;
  if (spec.startsWith('node:')) return null;
  const parts = spec.split('/');
  return spec.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0]!;
}

export function listSourceFiles(dir: string, limit = 5000): string[] {
  const out: string[] = [];
  const walk = (d: string) => {
    if (out.length >= limit) return;
    let entries: string[];
    try {
      entries = readdirSync(d);
    } catch {
      return;
    }
    for (const e of entries) {
      if (out.length >= limit) return;
      if (SKIP_DIRS.has(e) || e.startsWith('.')) continue;
      const full = join(d, e);
      let st;
      try {
        st = statSync(full);
      } catch {
        continue;
      }
      if (st.isDirectory()) walk(full);
      else if (SOURCE_EXT.has(extname(e)) && !e.endsWith('.d.ts')) out.push(full);
    }
  };
  walk(dir);
  return out;
}

/**
 * Scan a codebase for the symbols it uses from each bare-specifier import.
 *
 * Namespace and default bindings are tracked so member reads resolve to the
 * right package: `import fg from 'fast-glob'` + `fg.escapePath` records
 * `escapePath`, which is what makes the §9.0 report able to name a line.
 */

/**
 * Identifiers that appear in VALUE position.
 *
 * TypeScript erases imports used only as types, so a named import that never
 * appears in a value position asserts nothing about the runtime surface. This
 * is a syntactic approximation — no type checker — which is the right bias:
 * treating a genuine value use as type-only would UNDER-report, and a missed
 * detection is far cheaper than a false "this symbol does not exist".
 */
function collectValueIdentifiers(sf: ts.SourceFile): Set<string> {
  const out = new Set<string>();
  const visit = (node: ts.Node, inType: boolean): void => {
    const nowInType = inType || ts.isTypeNode(node) || ts.isTypeQueryNode(node);
    if (
      !nowInType &&
      ts.isIdentifier(node) &&
      node.parent &&
      !ts.isImportSpecifier(node.parent) &&
      !ts.isImportClause(node.parent) &&
      !ts.isNamespaceImport(node.parent) &&
      !ts.isPropertyAccessExpression(node.parent)
    ) {
      out.add(node.text);
    }
    // A property access still uses its OBJECT in value position.
    if (!nowInType && ts.isPropertyAccessExpression(node) && ts.isIdentifier(node.expression)) {
      out.add(node.expression.text);
    }
    ts.forEachChild(node, (c) => visit(c, nowInType));
  };
  visit(sf, false);
  return out;
}

export function scanReferences(rootDir: string, opts: { limit?: number } = {}): PackageReferences[] {
  const byPackage = new Map<string, Map<string, SymbolReference[]>>();

  const record = (
    pkg: string,
    symbol: string,
    via: ReferenceVia,
    specifier: string,
    file: string,
    line: number,
  ) => {
    let syms = byPackage.get(pkg);
    if (!syms) byPackage.set(pkg, (syms = new Map()));
    const list = syms.get(symbol);
    const ref = { symbol, via, specifier, file, line };
    if (list) {
      if (!list.some((r) => r.file === file && r.line === line)) list.push(ref);
    } else {
      syms.set(symbol, [ref]);
    }
  };

  for (const file of listSourceFiles(rootDir, opts.limit)) {
    let text: string;
    try {
      text = readFileSync(file, 'utf8');
    } catch {
      continue;
    }
    const rel = relative(rootDir, file);
    const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
    const lineOf = (n: ts.Node) => sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1;

    // Two binding maps, because member reads mean different things:
    // a namespace/CJS binding IS the module's exports; a default binding is a
    // VALUE that happens to have properties.
    const nsBindings = new Map<string, { pkg: string; spec: string }>();
    const defaultBindings = new Map<string, { pkg: string; spec: string }>();

    // Identifiers used in VALUE position. A named import used only in type
    // position (`(req: Request) => …`) is erased by TypeScript and never
    // reaches runtime, so it asserts nothing about the runtime surface.
    // `import express, { Request, Response } from 'express'` is correct code;
    // counting Request/Response as runtime symbols reports a miss on it.
    const valueUsed = collectValueIdentifiers(sf);

    const visit = (node: ts.Node): void => {
      // ── ESM imports ──
      if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
        const pkg = packageOfSpecifier(node.moduleSpecifier.text);
        if (pkg) {
          const clause = node.importClause;
          if (clause?.name) {
            record(pkg, 'default', 'default', node.moduleSpecifier.text, rel, lineOf(clause.name));
            defaultBindings.set(clause.name.text, { pkg, spec: node.moduleSpecifier.text });
          }
          if (clause?.namedBindings) {
            if (ts.isNamespaceImport(clause.namedBindings)) {
              nsBindings.set(clause.namedBindings.name.text, { pkg, spec: node.moduleSpecifier.text });
            } else {
              for (const el of clause.namedBindings.elements) {
                const local = el.name.text;
                const exported = el.propertyName?.text ?? local;
                const typeOnly = clause.isTypeOnly || el.isTypeOnly || !valueUsed.has(local);
                record(
                  pkg,
                  exported,
                  typeOnly ? 'type-only' : 'named',
                  node.moduleSpecifier.text,
                  rel,
                  lineOf(el),
                );
              }
            }
          }
        }
      }

      // ── CJS require ──
      if (
        ts.isVariableDeclaration(node) &&
        node.initializer &&
        ts.isCallExpression(node.initializer) &&
        ts.isIdentifier(node.initializer.expression) &&
        node.initializer.expression.text === 'require' &&
        node.initializer.arguments.length === 1 &&
        ts.isStringLiteral(node.initializer.arguments[0]!)
      ) {
        const spec = (node.initializer.arguments[0] as ts.StringLiteral).text;
        const pkg = packageOfSpecifier(spec);
        if (pkg) {
          if (ts.isIdentifier(node.name)) {
            // In CJS the binding IS module.exports, so member reads are export
            // claims — unless module.exports is a bare value, which the scorer
            // detects from the surface shape rather than guessing here.
            nsBindings.set(node.name.text, { pkg, spec });
            record(pkg, 'default', 'default', spec, rel, lineOf(node.name));
          } else if (ts.isObjectBindingPattern(node.name)) {
            for (const el of node.name.elements) {
              const name = el.propertyName ?? el.name;
              if (ts.isIdentifier(name)) record(pkg, name.text, 'destructured', spec, rel, lineOf(el));
            }
          }
        }
      }

      // ── member reads on a bound namespace/default ──
      if (ts.isPropertyAccessExpression(node) && ts.isIdentifier(node.expression)) {
        const ns = nsBindings.get(node.expression.text);
        const def = defaultBindings.get(node.expression.text);
        if (ns) record(ns.pkg, node.name.text, 'namespace', ns.spec, rel, lineOf(node));
        else if (def) record(def.pkg, node.name.text, 'default-member', def.spec, rel, lineOf(node));
      }

      ts.forEachChild(node, visit);
    };
    visit(sf);
  }

  return [...byPackage.entries()]
    .map(([pkg, symbols]) => ({ package: pkg, symbols }))
    .sort((a, b) => a.package.localeCompare(b.package));
}

/** Flatten to the shape `check_upgrade` consumes. */
export function referencedSymbols(refs: PackageReferences): string[] {
  return [...refs.symbols.keys()].sort();
}
