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
 * The parse is per-file, but the walk is not: a barrel entry that only forwards
 * (`export * from './lib'`) is followed a bounded number of hops and merged, so
 * the entry's shape doesn't decide whether a package has a surface.
 *
 * Entry resolution covers `types`/`typings`, the `exports` map's root entry and
 * `index.d.ts`, then `@types/<name>` for packages that ship no types at all —
 * the whole 14-package popular-library sample in scripts/surface-coverage.mts
 * now extracts, where 5 did before. This matters more than it used to: while
 * extraction was worker-only a miss was just a gap, but now that a miss extracts
 * on the request path (usage/service) it bounds how often `usage` can answer at
 * all. Run that script after changing anything here.
 *
 * ponytail: what still degrades to null is a package whose types are reachable
 * only through a subpath (`pkg/submodule`) with no root entry, and one whose
 * barrel chain runs deeper than MAX_HOPS. Both fall back to the README.
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
import { posix } from 'node:path';
import type * as TSApi from 'typescript';
import { HttpError, httpRequest } from '../core/http';
import { CACHE_TTL } from '../core/constants';
import type { ExportKind, ExportSymbol } from '../core/types';

/** The compiler module itself, threaded through the parse helpers as a value so
 *  nothing in this file references `typescript` at module scope. */
type Compiler = typeof TSApi;

const CDN = 'cdn.jsdelivr.net';

/** HTTP tuning for the CDN fetches. The read path passes a tighter budget than
 *  the worker: on the serving path a slow CDN must not hold a request open for
 *  the default 15s × 4 attempts. */
export interface ExtractOptions {
  timeoutMs?: number;
  retries?: number;
  /** Wall-clock ceiling on one extraction, after which no further fetches start.
   *  `timeoutMs` bounds a single fetch, but a barrel walk issues up to MAX_FILES
   *  of them across MAX_HOPS waves, so only this bounds the whole thing. Omitted
   *  → unbounded, which is what the worker wants: a cold jsDelivr edge can take
   *  a minute for a wide barrel, and that extraction is the one warming the cache
   *  for everyone after. */
  deadlineMs?: number;
}

/** One extraction's options with its deadline resolved to an absolute instant,
 *  so every fetch in the walk measures against the same clock. */
interface Walk extends ExtractOptions {
  expiresAt: number;
}

function startWalk(opts: ExtractOptions): Walk {
  return {
    ...opts,
    expiresAt: opts.deadlineMs === undefined ? Infinity : Date.now() + opts.deadlineMs,
  };
}

let compiler: Promise<Compiler | null> | undefined;

/**
 * Load `typescript` once per process, resolving null when it isn't installed.
 * Memoized on the promise so concurrent cold misses share one module load, and
 * so a missing compiler is only probed once.
 */
export function loadCompiler(): Promise<Compiler | null> {
  compiler ??= import('typescript')
    .then((m) => (m as { default?: Compiler }).default ?? (m as unknown as Compiler))
    .catch(() => null);
  return compiler;
}

interface FetchResult {
  text: string | null;
  /** True when the file's existence is unknown — a timeout, 5xx or network error
   *  rather than a 404. A surface is only as trustworthy as the completeness of
   *  the walk that built it, and the store is cache-forever, so this is what
   *  keeps a transient CDN failure from being frozen in as a package's API. */
  unknown: boolean;
}

async function fetchFile(
  url: string,
  opts: Walk,
  // Versions are immutable, so a long TTL is safe. Callers resolving a floating
  // range pass a shorter one.
  ttlMs: number = CACHE_TTL.depsDev,
): Promise<FetchResult> {
  // Out of time counts as unknown, not absent: the walk is then unsound and its
  // partial result is discarded rather than cached as the package's API.
  if (Date.now() >= opts.expiresAt) return { text: null, unknown: true };
  try {
    const { data } = await httpRequest<string>(url, {
      host: CDN,
      ttlMs,
      accept: 'text',
      ...(opts.timeoutMs !== undefined ? { timeoutMs: opts.timeoutMs } : {}),
      ...(opts.retries !== undefined ? { retries: opts.retries } : {}),
    });
    return { text: typeof data === 'string' ? data : null, unknown: false };
  } catch (err) {
    // jsDelivr answers 404 for a path a package doesn't ship, which is a real
    // answer: that candidate simply isn't the file.
    const missing = err instanceof HttpError && err.status === 404;
    return { text: null, unknown: !missing };
  }
}

async function fetchText(url: string, opts: Walk): Promise<string | null> {
  return (await fetchFile(url, opts)).text;
}

const DTS_EXT = /\.d\.[cm]?ts$/;
const JS_EXT = /\.(m|c)?js$/;

/** The declaration file pairing with a path: itself if it already is one, else
 *  the `.d.ts`/`.d.mts`/`.d.cts` sitting beside the JS. Null for anything else.
 *  This is the "types next to the JS" rule TypeScript itself resolves by. */
function declarationFor(path: string): string | null {
  if (DTS_EXT.test(path)) return path;
  const js = JS_EXT.exec(path);
  return js ? path.replace(JS_EXT, `.d.${js[1] ?? ''}ts`) : null;
}

/** Strip the leading `./` a manifest path carries; CDN paths are root-relative. */
function relativeToRoot(path: string): string {
  return path.replace(/^\.?\//, '');
}

/** Conditions walked when reading the root entry out of an `exports` map, in
 *  precedence order: an explicit types condition first (Node requires it to be
 *  declared first for exactly this reason), then the runtime targets, whose
 *  declaration siblings are the entry when no types condition exists at all. */
const EXPORT_CONDITIONS = ['types', 'typings', 'node', 'import', 'require', 'default'];

/**
 * The root (`"."`) target of an `exports` map, as a declaration path. Packages
 * that publish through `exports` alone (execa, ora) have no `types` field to
 * read, and some (uuid) name no types condition either — there the JS target's
 * declaration sibling is what TypeScript would resolve.
 */
export function typesFromExports(exports: unknown, depth = 0): string | null {
  if (depth > 4) return null; // Pathological nesting isn't worth chasing.
  if (typeof exports === 'string') return declarationFor(exports);
  if (!exports || typeof exports !== 'object') return null;
  if (Array.isArray(exports)) {
    for (const alt of exports) {
      const found = typesFromExports(alt, depth + 1);
      if (found) return found;
    }
    return null;
  }
  const map = exports as Record<string, unknown>;
  // A subpath map: only the root entry describes the package's main surface.
  if ('.' in map) return typesFromExports(map['.'], depth + 1);
  if (Object.keys(map).some((k) => k.startsWith('.'))) return null;
  for (const condition of EXPORT_CONDITIONS) {
    if (!(condition in map)) continue;
    const found = typesFromExports(map[condition], depth + 1);
    if (found) return found;
  }
  return null;
}

/**
 * The `.d.ts` entry paths to try, most authoritative first: `types`/`typings`,
 * then the `exports` map's root target, then the conventional `index.d.ts`.
 * Ordered rather than singular because a `types` field can point at a file the
 * package doesn't actually ship (or ships only under `exports`), and a 404 there
 * shouldn't end the extraction.
 */
function typesEntries(pkgJson: string): string[] {
  const entries: string[] = [];
  try {
    const manifest = JSON.parse(pkgJson);
    const declared: unknown = manifest.types ?? manifest.typings;
    if (typeof declared === 'string') entries.push(relativeToRoot(declared));
    const fromExports = typesFromExports(manifest.exports);
    if (fromExports) entries.push(relativeToRoot(fromExports));
  } catch {
    /* fall through to the conventional entry */
  }
  entries.push('index.d.ts');
  return [...new Set(entries)];
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

/** What a statement declares, as `[localName, kind, signature]` tuples — a
 *  `var`/`const` statement can declare several names, most statements one, and
 *  anonymous ones none. Used both for the local index and for the exported
 *  declarations themselves, so a name means the same thing either way. */
function declarationsIn(
  ts: Compiler,
  node: TSApi.Node,
  src: TSApi.SourceFile,
): Array<[string, ExportKind, string | null]> {
  if (ts.isVariableStatement(node)) {
    const out: Array<[string, ExportKind, string | null]> = [];
    for (const decl of node.declarationList.declarations) {
      if (ts.isIdentifier(decl.name)) {
        out.push([
          decl.name.text,
          'variable',
          decl.type ? normalize(decl.type.getText(src)) : null,
        ]);
      }
    }
    return out;
  }
  const named = node as TSApi.DeclarationStatement;
  if (named.name && ts.isIdentifier(named.name)) {
    return [[named.name.text, kindOf(ts, node), signatureOf(ts, node, src)]];
  }
  return [];
}

/** One parsed `.d.ts`: what it exports itself, plus the `export * from '…'`
 *  specifiers whose exports it forwards without naming (see `collectSurface`). */
export interface ParsedModule {
  symbols: ExportSymbol[];
  stars: string[];
}

/** Parse `.d.ts` text into a normalized, name-sorted export surface. The compiler
 *  is passed in (see `loadCompiler`) rather than imported at module scope. */
export function parseSurface(source: string, ts: Compiler): ExportSymbol[] {
  return parseModule(source, ts).symbols;
}

/** `parseSurface`, also reporting the star re-exports it could not resolve alone. */
export function parseModule(source: string, ts: Compiler): ParsedModule {
  const src = ts.createSourceFile('surface.d.ts', source, ts.ScriptTarget.Latest, true);
  const out = new Map<string, ExportSymbol>();
  const stars: string[] = [];

  const add = (name: string, kind: ExportKind, signature: string | null) => {
    if (!out.has(name)) out.set(name, { name, kind, signature });
  };

  // Index every top-level declaration by local name, exported or not. A `.d.ts`
  // rolled up by rollup-plugin-dts or api-extractor (vite, helmet, and most
  // bundled types) is a wall of bare `declare`s closed by ONE `export { … }`
  // block, so the statement carrying a name's kind and signature is almost never
  // the statement that exports it. Private declarations stay private: nothing
  // reaches `out` unless an export form below names it.
  const local = new Map<string, { kind: ExportKind; signature: string | null }>();
  const namespaces = new Map<string, TSApi.ModuleDeclaration>();
  for (const node of src.statements) {
    for (const [name, kind, signature] of declarationsIn(ts, node, src)) {
      if (!local.has(name)) local.set(name, { kind, signature });
    }
    if (
      ts.isModuleDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      !namespaces.has(node.name.text)
    ) {
      namespaces.set(node.name.text, node);
    }
  }

  /** Lift an ambient namespace's members to the top level. Members of a `declare
   *  namespace` are all exported, with or without the keyword. */
  const liftNamespace = (decl: TSApi.ModuleDeclaration) => {
    if (!decl.body || !ts.isModuleBlock(decl.body)) return;
    for (const stmt of decl.body.statements) {
      for (const [name, kind, signature] of declarationsIn(ts, stmt, src))
        add(name, kind, signature);
    }
  };

  for (const node of src.statements) {
    // `export { … }`, `export * from …`, `export = …`: the `export` keyword is
    // part of these statements' own syntax rather than a modifier, so they carry
    // no modifiers at all and must be matched BEFORE the modifier gate below.
    if (ts.isExportDeclaration(node)) {
      const clause = node.exportClause;
      if (!clause) {
        // `export * from './lib'` — this file names nothing; the exports are in
        // the target, which only the caller can fetch.
        if (node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
          stars.push(node.moduleSpecifier.text);
        }
        continue;
      }
      if (ts.isNamespaceExport(clause)) {
        // `export * as ns from './x'` binds the whole module under one name.
        add(clause.name.text, 'namespace', null);
        continue;
      }
      const reExport = node.moduleSpecifier !== undefined;
      for (const el of clause.elements) {
        // `export { Local as Public }` — the local binding holds the kind and
        // signature. A re-export from another module has neither, since a
        // single-file parse never sees that module's declarations.
        const decl = reExport ? undefined : local.get((el.propertyName ?? el.name).text);
        const typeOnly = node.isTypeOnly || el.isTypeOnly;
        add(el.name.text, decl?.kind ?? (typeOnly ? 'type' : 'unknown'), decl?.signature ?? null);
      }
      continue;
    }

    if (ts.isExportAssignment(node) && ts.isIdentifier(node.expression)) {
      const target = node.expression.text;
      const decl = local.get(target);
      // The exported value itself is `default`: that is the name an importing
      // agent binds it to, for both `export default x` and `export = x` under
      // esModuleInterop.
      if (decl) add('default', decl.kind, decl.signature);
      // `export = e` is the CommonJS shape (@types/express, @types/react): the
      // module's whole surface lives in a namespace merged onto `e`, so the
      // members ARE the public API, not properties of one exported symbol.
      const ns = node.isExportEquals ? namespaces.get(target) : undefined;
      if (ns) liftNamespace(ns);
      continue;
    }

    if (!hasExportModifier(ts, node)) continue;
    for (const [name, kind, signature] of declarationsIn(ts, node, src)) add(name, kind, signature);
  }

  return { symbols: [...out.values()].sort((a, b) => a.name.localeCompare(b.name)), stars };
}

/**
 * The `.d.ts` files a relative specifier could resolve to, most likely first.
 * Empty for anything this parse has no business fetching: a bare specifier names
 * another package, and a path climbing out of the version root isn't ours.
 */
export function dtsCandidates(fromFile: string, specifier: string): string[] {
  if (!specifier.startsWith('./') && !specifier.startsWith('../')) return [];
  const path = posix.normalize(posix.join(posix.dirname(fromFile), specifier));
  if (path.startsWith('..')) return [];
  // `export * from './table.js'` is the ESM `.d.ts` idiom (drizzle-orm).
  const paired = declarationFor(path);
  if (paired) return [paired];
  // Extensionless (zod's `export * from './lib'`): a sibling, else a directory
  // barrel. Ordered, not raced — the first almost always hits, so the second
  // costs a round-trip only for real directories.
  return [`${path}.d.ts`, `${path}/index.d.ts`];
}

/** How far a barrel chain is followed. zod needs all three hops: index.d.ts →
 *  lib/index.d.ts → lib/external.d.ts → the leaves that actually declare things. */
const MAX_HOPS = 3;

/** Ceiling on files fetched per extraction, across all hops. Bounds a wide
 *  barrel (drizzle-orm forwards 14 modules from its entry, each of which
 *  forwards more) so a request-path extraction can't fan out without limit. */
const MAX_FILES = 24;

/**
 * Merge a barrel's chain into one surface: parse `source`, then follow whatever
 * `export * from` it defers to, breadth-first. Bounded on both axes — MAX_HOPS
 * deep, MAX_FILES wide — because this runs on the `usage` read path under a
 * wall-clock budget; each hop's fetches go out in parallel so the cost is hops,
 * not files. Shallowest definition wins, so a barrel's own naming of a symbol
 * beats one it forwards.
 *
 * `sound` is false if any followed file couldn't be fetched. Stopping at the
 * caps is deliberate and deterministic — the same package always yields the same
 * surface — but a timed-out hop yields an arbitrary subset, and the caller
 * caches forever, so that one must not be mistaken for a package's API.
 */
async function collectSurface(
  ts: Compiler,
  root: string,
  entry: string,
  source: string,
  opts: Walk,
): Promise<{ symbols: ExportSymbol[]; sound: boolean }> {
  const merged = new Map<string, ExportSymbol>();
  const attempted = new Set<string>([entry]);
  let budget = MAX_FILES;
  let sound = true;

  /** Absorb one file's exports; hand back the candidate lists it defers to. */
  const absorb = (file: string, text: string): string[][] => {
    const { symbols, stars } = parseModule(text, ts);
    for (const s of symbols) if (!merged.has(s.name)) merged.set(s.name, s);
    return stars.map((spec) => dtsCandidates(file, spec)).filter((c) => c.length > 0);
  };

  /** Fetch the first candidate that exists. These are alternatives for ONE
   *  specifier, so they're tried in order rather than raced. `attempted` doubles
   *  as the cycle guard: a barrel that re-exports its own ancestor stops here. */
  const fetchFirst = async (candidates: string[]): Promise<[string, string] | null> => {
    for (const file of candidates) {
      if (attempted.has(file) || budget <= 0) continue;
      attempted.add(file);
      budget--;
      const { text, unknown } = await fetchFile(`${root}/${file}`, opts);
      if (text !== null) return [file, text];
      if (unknown) {
        sound = false;
        return null; // Don't read a 404 into the next candidate; we never got one.
      }
    }
    return null;
  };

  let frontier = absorb(entry, source);
  for (let hop = 0; hop < MAX_HOPS && frontier.length > 0 && budget > 0; hop++) {
    const fetched = await Promise.all(frontier.map(fetchFirst));
    frontier = fetched.flatMap((hit) => (hit ? absorb(hit[0], hit[1]) : []));
  }

  return { symbols: [...merged.values()].sort((a, b) => a.name.localeCompare(b.name)), sound };
}

/**
 * Walk one package version root: try its types entries in order, stopping at the
 * first that yields a surface. Tried in order and only as far as needed, so a
 * package whose `types` field resolves — the overwhelming majority — pays
 * nothing for the fallbacks behind it.
 */
async function surfaceFrom(
  ts: Compiler,
  root: string,
  pkgJson: string,
  opts: Walk,
): Promise<ExportSymbol[] | null> {
  for (const entry of typesEntries(pkgJson)) {
    const dts = await fetchText(`${root}/${entry}`, opts);
    if (!dts) continue;
    const { symbols, sound } = await collectSurface(ts, root, entry, dts, opts);
    // An unsound walk degrades to null rather than to a partial surface: null
    // means "fall back to the README" and is retried on the next request, while
    // a stored surface is believed forever. Under the read path's tight fetch
    // ceiling that is the likely outcome for a wide barrel on a cold CDN edge —
    // the worker, with the default timeouts, extracts it in full later.
    if (sound && symbols.length > 0) return symbols;
  }
  return null;
}

/** DefinitelyTyped's package name for a library: a scoped `@scope/name` mangles
 *  to `@types/scope__name`, since npm scopes don't nest. */
export function typesPackageName(name: string): string {
  return name.startsWith('@') ? `@types/${name.slice(1).replace('/', '__')}` : `@types/${name}`;
}

/**
 * The surface from DefinitelyTyped, for packages that ship no types of their own
 * (react, express, semver). Pinned to the MATCHING MAJOR, never to `latest`:
 * @types/react's latest types React 19, and storing that as react@18.3.1's API
 * would be a confident wrong answer rather than a missing one. Within the major
 * there is still skew — @types/semver@7.8.0 answers for semver@7.7.2 — which is
 * the approximation DefinitelyTyped's own versioning offers.
 */
async function typesPackageSurface(
  ts: Compiler,
  name: string,
  version: string,
  opts: Walk,
): Promise<ExportSymbol[] | null> {
  const major = /^\d+/.exec(version)?.[0];
  if (!major) return null;
  const dt = typesPackageName(name);
  // jsDelivr resolves the range and 404s when DefinitelyTyped has no matching
  // major. The manifest reports which version answered, and the file fetches
  // pin to it so a walk can't straddle two releases mid-flight.
  const { text: pkgJson } = await fetchFile(
    `https://${CDN}/npm/${dt}@${major}/package.json`,
    opts,
    CACHE_TTL.npmRegistry, // A floating range: don't hold it for a day.
  );
  if (!pkgJson) return null;
  let resolved: unknown;
  try {
    resolved = JSON.parse(pkgJson).version;
  } catch {
    return null;
  }
  if (typeof resolved !== 'string') return null;
  return surfaceFrom(ts, `https://${CDN}/npm/${dt}@${resolved}`, pkgJson, opts);
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
  // The deadline starts after the compiler load, not before: that cost is paid
  // once per process and isn't what a per-extraction ceiling is guarding.
  const walk = startWalk(opts);
  const root = `https://${CDN}/npm/${name}@${version}`;
  const pkgJson = await fetchText(`${root}/package.json`, walk);
  // No manifest means no answer either way. Falling through to @types here would
  // turn an unreachable CDN into a surface attributed to a package we never
  // established ships none of its own.
  if (!pkgJson) return null;
  return (
    (await surfaceFrom(ts, root, pkgJson, walk)) ?? typesPackageSurface(ts, name, version, walk)
  );
}
