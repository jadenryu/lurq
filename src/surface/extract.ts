/**
 * Tier A — shipped-JS surface extraction via module-graph AST (§6.2).
 *
 * Answers "does this symbol exist at runtime", which is what decides whether an
 * import throws. Never executes the subject's code — that property is what makes
 * enterprise extraction against a customer's private registry reviewable (§9.2).
 *
 * The single most important behaviour here is that it RECURSES through the
 * package-internal module graph. `module.exports = require('./lib/x')` is
 * ubiquitous; a single-file parse returns zero exports for express, debug, and
 * react (defect §6.4.5). Coverage on the study's 12-package smoke test went 9/12
 * with two total failures → 12/12 once the graph walk landed.
 *
 * Parser: the `typescript` package, which is already a devDependency and parses
 * plain JS fine. It stays on the operator plane — see 192ca3f for why it must
 * never enter the public bundle.
 */
import { readFileSync } from 'node:fs';
import { relative } from 'node:path';
import ts from 'typescript';
import {
  readManifest,
  resolveEntry,
  resolveInternal,
  resolvesInsidePackage,
  type PackageManifest,
} from './resolve';
import type { ExtractedSurface, SurfaceSymbol, SymbolKind } from './types';

const TIER = 'shipped_js_ast' as const;
const MAX_FILES = 400; // cycle guard is exact; this bounds pathological graphs

interface WalkCtx {
  pkgDir: string;
  visited: Set<string>;
  filesWalked: number;
  external: Set<string>;
  truncated: boolean;
}

/** Classify an expression into the IR's kind + arity. */
function classify(node: ts.Node): { kind: SymbolKind; arity: number | null } {
  if (ts.isFunctionExpression(node) || ts.isArrowFunction(node) || ts.isFunctionDeclaration(node)) {
    return { kind: 'function', arity: arityOf(node) };
  }
  if (ts.isClassExpression(node) || ts.isClassDeclaration(node)) return { kind: 'class', arity: null };
  if (ts.isObjectLiteralExpression(node)) return { kind: 'object', arity: null };
  if (
    ts.isStringLiteral(node) ||
    ts.isNumericLiteral(node) ||
    node.kind === ts.SyntaxKind.TrueKeyword ||
    node.kind === ts.SyntaxKind.FalseKeyword ||
    node.kind === ts.SyntaxKind.NullKeyword
  ) {
    return { kind: 'primitive', arity: null };
  }
  return { kind: 'object', arity: null };
}

/**
 * `fn.length` semantics: parameters before the first one with a default or rest.
 * Matching the runtime definition matters because arity drift is compared against
 * values captured at tier B, where it really is `fn.length`.
 */
function arityOf(fn: ts.SignatureDeclarationBase): number {
  let n = 0;
  for (const p of fn.parameters) {
    if (p.initializer || p.dotDotDotToken) break;
    n++;
  }
  return n;
}

function lineOf(sf: ts.SourceFile, node: ts.Node): number {
  return sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1;
}

function put(
  out: Map<string, SurfaceSymbol>,
  sym: SurfaceSymbol,
): void {
  // First writer wins: the entry file's own binding outranks a later re-export.
  if (!out.has(sym.path)) out.set(sym.path, sym);
}

/** Resolve an identifier to its initializer within the same file, if declared there. */
function localBinding(sf: ts.SourceFile, name: string): ts.Node | null {
  let found: ts.Node | null = null;
  for (const stmt of sf.statements) {
    if (ts.isVariableStatement(stmt)) {
      for (const d of stmt.declarationList.declarations) {
        if (ts.isIdentifier(d.name) && d.name.text === name && d.initializer) found = d.initializer;
      }
    } else if (ts.isFunctionDeclaration(stmt) && stmt.name?.text === name) {
      found = stmt;
    } else if (ts.isClassDeclaration(stmt) && stmt.name?.text === name) {
      found = stmt;
    }
  }
  return found;
}

function isModuleExports(e: ts.Expression): boolean {
  return (
    ts.isPropertyAccessExpression(e) &&
    ts.isIdentifier(e.expression) &&
    e.expression.text === 'module' &&
    e.name.text === 'exports'
  );
}

/** `module.exports.X` / `exports.X` → "X"; null if it isn't an exports write. */
function exportTargetName(e: ts.Expression): string | null {
  if (!ts.isPropertyAccessExpression(e)) return null;
  if (ts.isIdentifier(e.expression) && e.expression.text === 'exports') return e.name.text;
  if (isModuleExports(e.expression)) return e.name.text;
  return null;
}

function hasDeprecatedTag(sf: ts.SourceFile, node: ts.Node): boolean {
  const full = node.getFullText(sf);
  const lead = full.slice(0, full.length - node.getText(sf).length);
  return /@deprecated/i.test(lead);
}

/**
 * Top-level statements plus those nested in control flow.
 *
 * `debug` ships `if (…) { module.exports = require('./browser.js') } else { … }`
 * — a top-level-only scan returns zero exports for it, which is defect §6.4.5.
 * Function and class bodies are deliberately NOT descended into: an assignment
 * inside a function is not the module's surface.
 */
export function flattenStatements(
  stmts: readonly ts.Statement[],
  depth = 0,
): ts.Statement[] {
  if (depth > 6) return [...stmts];
  const out: ts.Statement[] = [];
  for (const s of stmts) {
    out.push(s);
    if (ts.isBlock(s)) out.push(...flattenStatements(s.statements, depth + 1));
    else if (ts.isIfStatement(s)) {
      const branches = [s.thenStatement, s.elseStatement].filter(Boolean) as ts.Statement[];
      for (const b of branches) {
        out.push(...flattenStatements(ts.isBlock(b) ? b.statements : [b], depth + 1));
      }
    } else if (ts.isTryStatement(s)) {
      out.push(...flattenStatements(s.tryBlock.statements, depth + 1));
      if (s.catchClause) out.push(...flattenStatements(s.catchClause.block.statements, depth + 1));
      if (s.finallyBlock) out.push(...flattenStatements(s.finallyBlock.statements, depth + 1));
    } else if (ts.isSwitchStatement(s)) {
      for (const c of s.caseBlock.clauses) {
        out.push(...flattenStatements(c.statements, depth + 1));
      }
    }
  }
  return out;
}

function walk(file: string, ctx: WalkCtx, out: Map<string, SurfaceSymbol>): void {
  if (ctx.visited.has(file)) return; // cycle guard (§6.2)
  if (ctx.filesWalked >= MAX_FILES) {
    ctx.truncated = true;
    return;
  }
  ctx.visited.add(file);
  ctx.filesWalked++;

  let text: string;
  try {
    text = readFileSync(file, 'utf8');
  } catch {
    return;
  }
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  const rel = relative(ctx.pkgDir, file);

  const add = (path: string, node: ts.Node, over: Partial<SurfaceSymbol> = {}) => {
    const { kind, arity } = classify(node);
    put(out, {
      path,
      kind,
      arity,
      origin: 'local',
      deprecated: hasDeprecatedTag(sf, node),
      tier: TIER,
      sourceRef: { file: rel, line: lineOf(sf, node) },
      ...over,
    });
  };

  /**
   * A re-export specifier: recurse if internal, record as external if not
   * (§6.4.1).
   *
   * `picks` carries the named subset for `export { a, b as c } from './x'`.
   * Honouring it is not optional: `uuid` re-exports one `default` per internal
   * file (`export { default as MAX } from './max.js'`), so merging the target's
   * whole surface both INVENTS its internal helpers as package exports and LOSES
   * the renamed ones. Measured at 3/10 baseline precision before this — the
   * worst class of error we can make, since it claims symbols that do not exist.
   */
  const reExport = (
    spec: string,
    names: string[] | null,
    picks?: { from: string; as: string }[],
  ): void => {
    if (resolvesInsidePackage(spec)) {
      const target = resolveInternal(file, spec, ctx.pkgDir);
      if (!target) return;
      if (!picks) {
        walk(target, ctx, out); // `export * from` — the whole surface is correct
        return;
      }
      // Selective: resolve the target's surface separately, then take only what
      // was asked for, under the name it was asked for.
      const sub = new Map<string, SurfaceSymbol>();
      walk(target, { ...ctx, visited: new Set(ctx.visited) }, sub);
      for (const pick of picks) {
        const found = sub.get(pick.from);
        if (found) put(out, { ...found, path: pick.as });
        else put(out, { path: pick.as, kind: 'object', arity: null, origin: 'local', deprecated: false, tier: TIER, sourceRef: { file: rel, line: 1 } });
      }
      return;
    }
    ctx.external.add(spec);
    for (const n of names ?? []) {
      put(out, {
        path: n,
        kind: 'object',
        arity: null,
        origin: `external:${spec}`,
        deprecated: false,
        tier: TIER,
        sourceRef: { file: rel, line: 1 },
      });
    }
  };

  for (const stmt of flattenStatements(sf.statements)) {
    // ── ESM ────────────────────────────────────────────────────────────────
    if (ts.isExportDeclaration(stmt)) {
      const spec =
        stmt.moduleSpecifier && ts.isStringLiteral(stmt.moduleSpecifier)
          ? stmt.moduleSpecifier.text
          : null;
      const isTypeOnly = stmt.isTypeOnly;
      if (stmt.exportClause && ts.isNamedExports(stmt.exportClause)) {
        const names = stmt.exportClause.elements.map((el) => el.name.text);
        if (spec) {
          reExport(
            spec,
            names,
            stmt.exportClause.elements.map((el) => ({
              from: el.propertyName?.text ?? el.name.text,
              as: el.name.text,
            })),
          );
        } else {
          for (const el of stmt.exportClause.elements) {
            const local = el.propertyName?.text ?? el.name.text;
            const decl = localBinding(sf, local);
            if (isTypeOnly || el.isTypeOnly) {
              put(out, {
                path: el.name.text,
                kind: 'type_only',
                arity: null,
                origin: 'local',
                deprecated: false,
                tier: TIER,
                sourceRef: { file: rel, line: lineOf(sf, el) },
              });
            } else if (decl) {
              add(el.name.text, decl);
            } else {
              add(el.name.text, el);
            }
          }
        }
      } else if (spec) {
        // `export * from '<spec>'`
        reExport(spec, null);
      }
      continue;
    }

    // `export const X` / `export function X` / `export class X`
    const mods = ts.canHaveModifiers(stmt) ? ts.getModifiers(stmt) : undefined;
    const exported = mods?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword);
    if (exported) {
      if (ts.isVariableStatement(stmt)) {
        for (const d of stmt.declarationList.declarations) {
          if (ts.isIdentifier(d.name)) add(d.name.text, d.initializer ?? d);
        }
      } else if (ts.isFunctionDeclaration(stmt) && stmt.name) {
        add(stmt.name.text, stmt);
      } else if (ts.isClassDeclaration(stmt) && stmt.name) {
        add(stmt.name.text, stmt);
      } else if (ts.isInterfaceDeclaration(stmt) || ts.isTypeAliasDeclaration(stmt)) {
        // §6.4.4: type-only. Never counted in runtime-surface diffs.
        put(out, {
          path: stmt.name.text,
          kind: 'type_only',
          arity: null,
          origin: 'local',
          deprecated: false,
          tier: TIER,
          sourceRef: { file: rel, line: lineOf(sf, stmt) },
        });
      }
      continue;
    }

    if (ts.isExportAssignment(stmt)) {
      // `export default <expr>`
      const target = ts.isIdentifier(stmt.expression)
        ? (localBinding(sf, stmt.expression.text) ?? stmt.expression)
        : stmt.expression;
      add('default', target);
      continue;
    }

    // ── CommonJS ───────────────────────────────────────────────────────────
    if (ts.isExpressionStatement(stmt)) {
      const e = stmt.expression;

      // Object.defineProperty(exports, "name", { get() {…} }) — Babel's CJS
      // output, and older tsc's. Extremely common on npm: uuid@9 declares its
      // entire surface this way, and without this branch every Babel-compiled
      // package extracts as zero exports and lands as UNDECLARED.
      if (
        ts.isCallExpression(e) &&
        ts.isPropertyAccessExpression(e.expression) &&
        ts.isIdentifier(e.expression.expression) &&
        e.expression.expression.text === 'Object' &&
        e.expression.name.text === 'defineProperty' &&
        e.arguments.length >= 2
      ) {
        const targetArg = e.arguments[0]!;
        const isExportsTarget =
          (ts.isIdentifier(targetArg) && targetArg.text === 'exports') ||
          isModuleExports(targetArg as ts.Expression);
        const nameArg = e.arguments[1]!;
        if (isExportsTarget && ts.isStringLiteral(nameArg) && nameArg.text !== '__esModule') {
          // The descriptor's getter usually forwards to another module
          // (`return _nil.default`), so the VALUE is not statically known — but
          // existence is, and existence is what tier A is for.
          put(out, {
            path: nameArg.text,
            kind: 'object',
            arity: null,
            origin: 'local',
            deprecated: hasDeprecatedTag(sf, stmt),
            tier: TIER,
            sourceRef: { file: rel, line: lineOf(sf, stmt) },
          });
          continue;
        }
      }

      // Object.assign(module.exports, X, …) / __exportStar(require('x'), …)
      if (ts.isCallExpression(e)) {
        const callee = e.expression;
        const isObjectAssign =
          ts.isPropertyAccessExpression(callee) &&
          ts.isIdentifier(callee.expression) &&
          callee.expression.text === 'Object' &&
          callee.name.text === 'assign' &&
          e.arguments.length > 0 &&
          isModuleExports(e.arguments[0]!);
        // esbuild emits `__reExport(target, require('./x'), module.exports)`, tsc
        // emits `__exportStar(require('./x'), exports)`. Helper names and argument
        // order both vary, so match the family and scan every argument for a
        // require() rather than assuming a slot.
        const isExportStar =
          ts.isIdentifier(callee) && /^_{0,2}(exportStar|reExport|export)$/i.test(callee.text);

        if (isObjectAssign || isExportStar) {
          for (const arg of e.arguments.slice(isObjectAssign ? 1 : 0)) {
            const spec = requireSpecifier(arg);
            if (spec) reExport(spec, null);
            else if (ts.isObjectLiteralExpression(arg)) {
              for (const p of arg.properties) {
                if (p.name && ts.isIdentifier(p.name)) {
                  add(p.name.text, ts.isPropertyAssignment(p) ? p.initializer : p);
                }
              }
            } else if (ts.isIdentifier(arg)) {
              const b = localBinding(sf, arg.text);
              if (b && ts.isObjectLiteralExpression(b)) {
                for (const p of b.properties) {
                  if (p.name && ts.isIdentifier(p.name)) {
                    add(p.name.text, ts.isPropertyAssignment(p) ? p.initializer : p);
                  }
                }
              }
            }
          }
          continue;
        }
      }

      if (!ts.isBinaryExpression(e) || e.operatorToken.kind !== ts.SyntaxKind.EqualsToken) continue;
      const lhs = e.left;
      const rhs = e.right;

      // module.exports = <expr>
      if (isModuleExports(lhs)) {
        const spec = requireSpecifier(rhs);
        if (spec) {
          reExport(spec, null);
          continue;
        }
        if (ts.isObjectLiteralExpression(rhs)) {
          for (const p of rhs.properties) {
            if (p.name && ts.isIdentifier(p.name)) {
              add(p.name.text, ts.isPropertyAssignment(p) ? p.initializer : p);
            }
          }
          continue;
        }
        if (ts.isIdentifier(rhs)) {
          // `const N = {…}; module.exports = N` — resolve the binding (§6.2)
          const b = localBinding(sf, rhs.text);
          if (b && ts.isObjectLiteralExpression(b)) {
            for (const p of b.properties) {
              if (p.name && ts.isIdentifier(p.name)) {
                add(p.name.text, ts.isPropertyAssignment(p) ? p.initializer : p);
              }
            }
            continue;
          }
          if (b) {
            add('default', b);
            continue;
          }
        }
        add('default', rhs);
        continue;
      }

      // module.exports.X = <expr> / exports.X = <expr>
      const name = exportTargetName(lhs);
      if (name) {
        const spec = requireSpecifier(rhs);
        if (spec && !resolvesInsidePackage(spec)) {
          ctx.external.add(spec);
          put(out, {
            path: name,
            kind: 'object',
            arity: null,
            origin: `external:${spec}`,
            deprecated: false,
            tier: TIER,
            sourceRef: { file: rel, line: lineOf(sf, stmt) },
          });
          continue;
        }
        const target = ts.isIdentifier(rhs) ? (localBinding(sf, rhs.text) ?? rhs) : rhs;
        add(name, target, { deprecated: hasDeprecatedTag(sf, stmt) });
      }
    }
  }
}

/** `require('x')` → 'x', including `require('x').y`. Null otherwise. */
function requireSpecifier(node: ts.Node): string | null {
  let n: ts.Node = node;
  if (ts.isPropertyAccessExpression(n)) n = n.expression;
  if (
    ts.isCallExpression(n) &&
    ts.isIdentifier(n.expression) &&
    n.expression.text === 'require' &&
    n.arguments.length === 1 &&
    ts.isStringLiteral(n.arguments[0]!)
  ) {
    return (n.arguments[0] as ts.StringLiteral).text;
  }
  return null;
}

/**
 * Extract the tier-A runtime surface of an installed package directory.
 * Never throws for a subject-side problem — a package with no resolvable entry
 * returns `undeclaredReason`, which the caller records as UNDECLARED, not as
 * absence (§4.2).
 */
export function extractSurface(
  pkgDir: string,
  opts: { manifest?: PackageManifest | null; subpath?: string } = {},
): ExtractedSurface {
  const manifest = opts.manifest ?? readManifest(pkgDir);
  const entry = resolveEntry(pkgDir, manifest, opts.subpath);
  const base: ExtractedSurface = {
    package: manifest?.name ?? pkgDir,
    version: manifest?.version ?? null,
    tier: TIER,
    entry: entry ? relative(pkgDir, entry) : null,
    symbols: [],
    filesWalked: 0,
    externalReExports: [],
  };
  if (!entry) {
    return {
      ...base,
      undeclaredReason: opts.subpath
        ? `no resolvable JS entry point for subpath ./${opts.subpath}`
        : 'no resolvable JS entry point',
    };
  }

  const ctx: WalkCtx = {
    pkgDir,
    visited: new Set(),
    filesWalked: 0,
    external: new Set(),
    truncated: false,
  };
  const out = new Map<string, SurfaceSymbol>();
  walk(entry, ctx, out);

  const symbols = [...out.values()].sort((a, b) => a.path.localeCompare(b.path));
  return {
    ...base,
    symbols,
    filesWalked: ctx.filesWalked,
    externalReExports: [...ctx.external].sort(),
    ...(symbols.length === 0
      ? { undeclaredReason: 'entry resolved but no exports found' }
      : {}),
  };
}
