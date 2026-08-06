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

export interface SymbolReference {
  /** Exported name used from the package. 'default' for a default import. */
  symbol: string;
  file: string;
  line: number;
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
export function scanReferences(rootDir: string, opts: { limit?: number } = {}): PackageReferences[] {
  const byPackage = new Map<string, Map<string, SymbolReference[]>>();

  const record = (pkg: string, symbol: string, file: string, line: number) => {
    let syms = byPackage.get(pkg);
    if (!syms) byPackage.set(pkg, (syms = new Map()));
    const list = syms.get(symbol);
    const ref = { symbol, file, line };
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

    /** identifier bound to a whole package → package name, for member reads. */
    const bindings = new Map<string, string>();

    const visit = (node: ts.Node): void => {
      // ── ESM imports ──
      if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
        const pkg = packageOfSpecifier(node.moduleSpecifier.text);
        if (pkg) {
          const clause = node.importClause;
          if (clause?.name) {
            record(pkg, 'default', rel, lineOf(clause.name));
            bindings.set(clause.name.text, pkg);
          }
          if (clause?.namedBindings) {
            if (ts.isNamespaceImport(clause.namedBindings)) {
              bindings.set(clause.namedBindings.name.text, pkg);
            } else {
              for (const el of clause.namedBindings.elements) {
                record(pkg, el.propertyName?.text ?? el.name.text, rel, lineOf(el));
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
        const pkg = packageOfSpecifier((node.initializer.arguments[0] as ts.StringLiteral).text);
        if (pkg) {
          if (ts.isIdentifier(node.name)) {
            bindings.set(node.name.text, pkg);
            record(pkg, 'default', rel, lineOf(node.name));
          } else if (ts.isObjectBindingPattern(node.name)) {
            for (const el of node.name.elements) {
              const name = el.propertyName ?? el.name;
              if (ts.isIdentifier(name)) record(pkg, name.text, rel, lineOf(el));
            }
          }
        }
      }

      // ── member reads on a bound namespace/default ──
      if (
        ts.isPropertyAccessExpression(node) &&
        ts.isIdentifier(node.expression) &&
        bindings.has(node.expression.text)
      ) {
        record(bindings.get(node.expression.text)!, node.name.text, rel, lineOf(node));
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
