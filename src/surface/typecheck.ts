/**
 * The type half of `check-upgrade`: which TypeScript errors does this upgrade
 * introduce into the files that import the package?
 *
 * Tier A answers "does this still exist at runtime". It cannot see that an
 * option was renamed, a parameter narrowed, or a return type widened to
 * `string | undefined`. Those pass `node`, fail `tsc`, and very often mark a
 * runtime behaviour change that no test covered. The compiler sees all of them.
 *
 * Nothing is installed. The project is checked twice with the package swapped
 * underneath it: once as the old version's tarball, once as the new one's, each
 * overlaid at `node_modules/<pkg>` through the compiler host. Only errors in the
 * second run that the first did not have are reported. That diff is what makes
 * this safe to run anywhere: an environment that resolves other dependencies
 * badly produces the same noise on both sides, and it cancels.
 *
 * Narrow on purpose, in three ways that each trade coverage for truth:
 *   - Files that import the package are checked, and files that import those:
 *     an upgrade's type change often lands in the code that uses your own
 *     wrapper, not in the wrapper. ponytail: one hop, capped at HOP_CAP files;
 *     a type that travels further than that is missed.
 *   - The new version must ship its own type definitions. Types from `@types/*`
 *     do not move with the upgrade, so comparing them says nothing.
 *   - Definitions this compiler cannot parse make the run unchecked, never
 *     clean: half-read types become `any`, and `any` hides errors.
 */
import { createRequire } from 'node:module';
import { dirname, join, relative, resolve } from 'node:path';
import type * as TSApi from 'typescript';

type Compiler = typeof TSApi;

export interface TypeDiagnostic {
  file: string;
  line: number;
  code: number;
  message: string;
}

export type TypeCheck =
  | { checked: true; files: number; introduced: TypeDiagnostic[] }
  | { checked: false; reason: string };

/** `files` are relative to the project root the checker was created for. */
export type TypeCheckFn = (
  pkg: string,
  fromDir: string,
  toDir: string,
  files: string[],
) => TypeCheck;

/**
 * Budget for every package's type check in one run. Two programs per package
 * over a large repository is real time, and a CI gate that hangs is a gate that
 * gets removed. Past it, the remaining packages report unchecked.
 */
const DEFAULT_BUDGET_MS = 180_000;
const MESSAGE_CAP = 300;
/** Importers of importers checked per project, on top of the direct importers. */
const HOP_CAP = 300;

/**
 * The project's own compiler when it has one, since the errors that matter are
 * the ones its `tsc` prints; lurq's bundled one otherwise.
 */
export async function loadCompiler(rootDir: string): Promise<Compiler | null> {
  try {
    return createRequire(join(resolve(rootDir), 'package.json'))('typescript') as Compiler;
  } catch {
    try {
      return (await import('typescript')).default as unknown as Compiler;
    } catch {
      return null;
    }
  }
}

export async function createTypeChecker(
  rootDir: string,
  opts: { budgetMs?: number } = {},
): Promise<TypeCheckFn | undefined> {
  const ts = await loadCompiler(rootDir);
  return ts ? typeChecker(ts, rootDir, opts) : undefined;
}

export function typeChecker(
  ts: Compiler,
  rootDir: string,
  opts: { budgetMs?: number } = {},
): TypeCheckFn {
  const root = resolve(rootDir);
  const expiresAt = Date.now() + (opts.budgetMs ?? DEFAULT_BUDGET_MS);
  const configs = new Map<string, TSApi.ParsedCommandLine | null>();
  // Parsed source files per tsconfig, shared by every program this run builds.
  // Your files and the lib files are identical in all of them; only the package
  // underneath changes, so re-parsing everything per program is most of the cost.
  //
  // ponytail: TypeScript 4 kept module resolutions on the SourceFile itself, so
  // sharing one across programs could carry a stale resolution. 5 moved them to
  // the program; older compilers just parse again.
  const shareSourceFiles = Number(ts.versionMajorMinor.split('.')[0]) >= 5;
  const caches = new Map<string, Map<string, TSApi.SourceFile>>();

  const parse = (configPath: string): TSApi.ParsedCommandLine | null => {
    if (!configs.has(configPath)) {
      const parsed = ts.getParsedCommandLineOfConfigFile(
        configPath,
        {},
        {
          ...ts.sys,
          onUnRecoverableConfigFileDiagnostic: () => {},
        },
      );
      configs.set(configPath, parsed ?? null);
    }
    return configs.get(configPath)!;
  };

  return (pkg, fromDir, toDir, files) => {
    if (Date.now() > expiresAt) {
      return { checked: false, reason: 'type check budget used up by earlier packages' };
    }
    const groups = groupByProject(ts, root, files, parse);
    if (groups.size === 0) {
      return { checked: false, reason: 'no tsconfig.json includes the files that import it' };
    }

    // The installed copy pnpm keeps under `.pnpm/<name>@<version>` is named for the
    // version being upgraded from, which is how the overlay recognises it.
    const installedVersion = manifestVersion(ts, fromDir);
    const introduced: TypeDiagnostic[] = [];
    let covered = 0;
    for (const [configPath, group] of groups) {
      let cache = caches.get(configPath);
      if (!cache) caches.set(configPath, (cache = new Map()));
      const shared = shareSourceFiles ? cache : new Map<string, TSApi.SourceFile>();

      const before = build(ts, group.parsed, pkg, fromDir, installedVersion, shared, false);
      if ('reason' in before) return { checked: false, reason: `old version: ${before.reason}` };
      // Found once, on the old program, and checked identically on both sides.
      const files = [...group.files, ...importersOf(ts, before.program, group.files)];
      const beforeDiagnostics = semanticDiagnostics(before.program, files);
      if (Date.now() > expiresAt) return { checked: false, reason: 'type check ran out of time' };
      const after = build(ts, group.parsed, pkg, toDir, installedVersion, shared, true);
      if ('reason' in after) return { checked: false, reason: after.reason };
      // Types that now lean on a dependency this checkout has not installed read
      // as empty interfaces, and those report errors an install would clear.
      const missingBefore = unresolvedTypeImports(ts, before);
      const newlyMissing = [...unresolvedTypeImports(ts, after)].filter(
        (s) => !missingBefore.has(s),
      );
      if (newlyMissing.length) {
        return {
          checked: false,
          reason: `the new version's types import ${newlyMissing.join(', ')}, which is not installed here`,
        };
      }

      introduced.push(
        ...newDiagnostics(ts, root, beforeDiagnostics, semanticDiagnostics(after.program, files)),
      );
      covered += files.length;
    }
    return { checked: true, files: covered, introduced };
  };
}

interface ProjectGroup {
  parsed: TSApi.ParsedCommandLine;
  files: string[];
}

/** The files, grouped by the tsconfig that actually includes each one. */
function groupByProject(
  ts: Compiler,
  root: string,
  files: string[],
  parse: (configPath: string) => TSApi.ParsedCommandLine | null,
): Map<string, ProjectGroup> {
  const groups = new Map<string, ProjectGroup>();
  for (const rel of new Set(files)) {
    const abs = join(root, rel);
    const project = projectFor(ts, root, abs, parse);
    if (!project) continue;
    const group = groups.get(project.configPath);
    if (group) group.files.push(abs);
    else groups.set(project.configPath, { parsed: project.parsed, files: [abs] });
  }
  return groups;
}

/**
 * The nearest tsconfig above the file, as `tsc` would pick it, provided it
 * includes the file.
 *
 * A solution-style tsconfig (Vite's default) lists no files of its own and
 * defers to `references`, so the file belongs to whichever referenced project
 * includes it. Without that step every Vite app reads as "no tsconfig".
 */
function projectFor(
  ts: Compiler,
  root: string,
  abs: string,
  parse: (configPath: string) => TSApi.ParsedCommandLine | null,
): { configPath: string; parsed: TSApi.ParsedCommandLine } | null {
  const key = (p: string) => (ts.sys.useCaseSensitiveFileNames ? p : p.toLowerCase());
  const includes = (parsed: TSApi.ParsedCommandLine) =>
    parsed.fileNames.some((f) => key(resolve(f)) === key(abs));

  for (let dir = dirname(abs); ; dir = dirname(dir)) {
    const config = join(dir, 'tsconfig.json');
    if (ts.sys.fileExists(config)) {
      const parsed = parse(config);
      if (!parsed) return null;
      if (includes(parsed)) return { configPath: config, parsed };
      for (const ref of parsed.projectReferences ?? []) {
        const refPath = ts.resolveProjectReferencePath(ref);
        const refParsed = parse(refPath);
        if (refParsed && includes(refParsed)) return { configPath: refPath, parsed: refParsed };
      }
      return null;
    }
    if (dir === root || dirname(dir) === dir) return null;
  }
}

/**
 * One program with `pkgDir` standing in for the package. `ownTypes` demands the
 * package's declarations came from the overlay, which is the new-version
 * requirement described up top.
 */
interface Built {
  program: TSApi.Program;
  host: TSApi.CompilerHost;
  overlaid: (fileName: string) => boolean;
}

function build(
  ts: Compiler,
  parsed: TSApi.ParsedCommandLine,
  pkg: string,
  pkgDir: string,
  installedVersion: string | undefined,
  cache: Map<string, TSApi.SourceFile>,
  ownTypes: boolean,
): Built | { reason: string } {
  const options: TSApi.CompilerOptions = { ...parsed.options, noEmit: true, incremental: false };
  const { host, overlaid } = overlayHost(ts, options, pkg, pkgDir, installedVersion, cache);
  // No `projectReferences`: those point imports at a referenced project's built
  // output, which a fresh checkout does not have. Reading the sources is closer
  // to what the developer's editor sees.
  const program = ts.createProgram({ rootNames: parsed.fileNames, options, host });

  const declarations = program
    .getSourceFiles()
    .filter((sf) => sf.isDeclarationFile && overlaid(sf.fileName));
  if (ownTypes && declarations.length === 0) {
    return { reason: 'the new version ships no type definitions of its own' };
  }
  if (declarations.some((sf) => program.getSyntacticDiagnostics(sf).length > 0)) {
    return { reason: `its type definitions do not parse with TypeScript ${ts.version}` };
  }

  return { program, host, overlaid };
}

/** What the package's own declarations import that does not resolve here. */
function unresolvedTypeImports(ts: Compiler, built: Built): Set<string> {
  const out = new Set<string>();
  const options = built.program.getCompilerOptions();
  for (const sf of built.program.getSourceFiles()) {
    if (!sf.isDeclarationFile || !built.overlaid(sf.fileName)) continue;
    for (const { fileName: spec } of ts.preProcessFile(sf.text, true, true).importedFiles) {
      if (!ts.resolveModuleName(spec, sf.fileName, options, built.host).resolvedModule)
        out.add(spec);
    }
  }
  return out;
}

function manifestVersion(ts: Compiler, dir: string): string | undefined {
  try {
    const version = (
      JSON.parse(ts.sys.readFile(join(dir, 'package.json')) ?? '{}') as { version?: unknown }
    ).version;
    return typeof version === 'string' ? version : undefined;
  } catch {
    return undefined;
  }
}

function semanticDiagnostics(program: TSApi.Program, files: string[]): TSApi.Diagnostic[] {
  return files.flatMap((f) => {
    const sf = program.getSourceFile(f);
    return sf ? [...program.getSemanticDiagnostics(sf)] : [];
  });
}

/**
 * Project files that import one of `targets`, resolved the way the compiler
 * resolves them, so relative paths and `paths` aliases both count.
 */
function importersOf(ts: Compiler, program: TSApi.Program, targets: string[]): string[] {
  const key = (p: string) =>
    ts.sys.useCaseSensitiveFileNames ? resolve(p) : resolve(p).toLowerCase();
  const wanted = new Set(targets.map(key));
  const options = program.getCompilerOptions();
  const cache = ts.createModuleResolutionCache(
    program.getCurrentDirectory(),
    (f) => key(f),
    options,
  );
  const out: string[] = [];
  for (const sf of program.getSourceFiles()) {
    if (out.length >= HOP_CAP) break;
    if (
      sf.isDeclarationFile ||
      sf.fileName.includes('/node_modules/') ||
      wanted.has(key(sf.fileName))
    )
      continue;
    const { importedFiles } = ts.preProcessFile(sf.text, true, true);
    const imports = importedFiles.some(({ fileName: spec }) => {
      const hit = ts.resolveModuleName(spec, sf.fileName, options, ts.sys, cache).resolvedModule;
      return hit !== undefined && wanted.has(key(hit.resolvedFileName));
    });
    if (imports) out.push(sf.fileName);
  }
  return out;
}

/**
 * A compiler host that serves `pkgDir` wherever the project would load the
 * package from `node_modules`.
 *
 * Only the project's own install is replaced: `node_modules/<pkg>` whose path
 * holds no other `node_modules`, or pnpm's store copy for the installed version
 * (`node_modules/.pnpm/<pkg>@<version>…/node_modules/<pkg>`), which is the same
 * install that peer-dependent packages link to. Leaving that copy on the old
 * version made pnpm projects report errors an install would not. Any other
 * nested copy belongs to another dependency and does not move with this upgrade.
 */
function overlayHost(
  ts: Compiler,
  options: TSApi.CompilerOptions,
  pkg: string,
  pkgDir: string,
  installedVersion: string | undefined,
  cache: Map<string, TSApi.SourceFile>,
): { host: TSApi.CompilerHost; overlaid: (fileName: string) => boolean } {
  const host = ts.createCompilerHost(options, true);
  const base = {
    fileExists: host.fileExists.bind(host),
    readFile: host.readFile.bind(host),
    directoryExists: host.directoryExists?.bind(host),
    realpath: host.realpath?.bind(host),
    getSourceFile: host.getSourceFile.bind(host),
  };
  const marker = `/node_modules/${pkg}`;
  const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  // pnpm writes a scoped name's slash as `+`, and appends peer suffixes after the version.
  const pnpmStore = installedVersion
    ? new RegExp(
        `^(.*)/node_modules/\\.pnpm/${escape(pkg.replace('/', '+'))}@${escape(installedVersion)}(?:[_(][^/]*)?$`,
      )
    : null;
  const ownInstall = (prefix: string) => {
    if (!prefix.includes('/node_modules/')) return true;
    const store = pnpmStore?.exec(prefix);
    return Boolean(store && !store[1]!.includes('/node_modules/'));
  };
  const direct = (fileName: string): string | null => {
    const p = fileName.replace(/\\/g, '/');
    const i = p.indexOf(marker);
    if (i < 0 || !ownInstall(p.slice(0, i))) return null;
    const rest = p.slice(i + marker.length);
    // `cookie-parser` is not `cookie`.
    return rest === '' || rest.startsWith('/') ? pkgDir + rest : null;
  };
  // A symlinked install reaches the package through another package's
  // node_modules (pnpm links a peer-dependent adapter to the project's copy).
  // Judged by where the package ROOT really lives, so a file that exists only in
  // the new version still resolves, and a link to a different version does not
  // match. Without this the adapter read the old package.json through the link,
  // and TypeScript kept two versions of one type apart.
  const redirect = (fileName: string): string | null => {
    const hit = direct(fileName);
    if (hit !== null || !ts.sys.realpath) return hit;
    const p = fileName.replace(/\\/g, '/');
    const i = p.lastIndexOf(marker);
    const end = i + marker.length;
    if (i < 0 || (p.length > end && p[end] !== '/')) return null;
    const root = ts.sys.realpath(p.slice(0, end)).replace(/\\/g, '/');
    return root === p.slice(0, end) ? null : direct(root + p.slice(end));
  };

  host.fileExists = (p) => {
    const r = redirect(p);
    return r === null ? base.fileExists(p) : ts.sys.fileExists(r);
  };
  host.readFile = (p) => {
    const r = redirect(p);
    return r === null ? base.readFile(p) : ts.sys.readFile(r);
  };
  host.directoryExists = (p) => {
    const r = redirect(p);
    if (r !== null) return ts.sys.directoryExists(r);
    // A fresh checkout may have no node_modules at all, and resolution only
    // looks inside one it believes exists. Probing an empty one costs nothing.
    const norm = p.replace(/\\/g, '/');
    if (
      norm.endsWith('/node_modules') &&
      !norm.slice(0, -'/node_modules'.length).includes('/node_modules')
    ) {
      return true;
    }
    return base.directoryExists ? base.directoryExists(p) : ts.sys.directoryExists(p);
  };
  // Identity for overlaid paths, so a symlinked install (pnpm) is not followed
  // back to the version actually on disk.
  host.realpath = (p) => (redirect(p) !== null ? p : base.realpath ? base.realpath(p) : p);
  host.getSourceFile = (fileName, languageVersion, onError, shouldCreateNewSourceFile) => {
    const r = redirect(fileName);
    if (r !== null) {
      const text = ts.sys.readFile(r);
      return text === undefined ? undefined : ts.createSourceFile(fileName, text, languageVersion);
    }
    const hit = cache.get(fileName);
    if (hit) return hit;
    const sf = base.getSourceFile(fileName, languageVersion, onError, shouldCreateNewSourceFile);
    if (sf) cache.set(fileName, sf);
    return sf;
  };

  return { host, overlaid: (fileName) => redirect(fileName) !== null };
}

/**
 * Errors in `after` that `before` did not have, matched on file, line and code.
 *
 * Not on the message: messages quote the package's own type names, so an error
 * your code already had reads differently once those types are renamed, and
 * matching on text would report it as new. Counted, so a second identical error
 * on a line that already had one is still reported.
 */
function newDiagnostics(
  ts: Compiler,
  root: string,
  before: TSApi.Diagnostic[],
  after: TSApi.Diagnostic[],
): TypeDiagnostic[] {
  const where = (d: TSApi.Diagnostic) =>
    d.file && d.start !== undefined
      ? { fileName: d.file.fileName, line: d.file.getLineAndCharacterOfPosition(d.start).line + 1 }
      : null;
  const remaining = new Map<string, number>();
  for (const d of before) {
    const at = where(d);
    if (!at) continue;
    const key = `${at.fileName}:${at.line}:${d.code}`;
    remaining.set(key, (remaining.get(key) ?? 0) + 1);
  }

  const out: TypeDiagnostic[] = [];
  for (const d of after) {
    const at = where(d);
    if (!at) continue;
    const key = `${at.fileName}:${at.line}:${d.code}`;
    const left = remaining.get(key) ?? 0;
    if (left > 0) {
      remaining.set(key, left - 1);
      continue;
    }
    out.push({
      file: relative(root, at.fileName),
      line: at.line,
      code: d.code,
      message: ts.flattenDiagnosticMessageText(d.messageText, ' ').slice(0, MESSAGE_CAP),
    });
  }
  return out;
}
