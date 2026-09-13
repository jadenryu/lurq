/**
 * Normalized surface IR (v1 spec §6.3).
 *
 * Deliberately ecosystem-agnostic: this shape is what makes a second ecosystem
 * cheap instead of linear, so nothing npm-specific belongs here. Per-ecosystem
 * detail goes in a sidecar, never forced into the common shape.
 */

/**
 * §6.2. Ordered by authority for RUNTIME-existence claims. Tier A is primary
 * (89.3% coverage in the study); C is type-level only and must never answer
 * "does this symbol exist at runtime" — a removed type breaks `tsc`, a removed
 * runtime symbol breaks `node`.
 */
export type ExtractionTier =
  | 'shipped_js_ast' // A, primary
  | 'runtime_import' // B, sandboxed require/import; the cost driver
  | 'bundled_dts' // C, secondary, signatures + deprecation only
  | 'types_package' // D, DefinitelyTyped; drifts from the real package
  | 'jsdoc_generated' // E, rarely reached
  /**
   * MCP `tools/list`. Not on the A–E authority ladder at all: those tiers rank
   * ways of reading ONE artifact (a package's shipped code), and this reads a
   * different artifact entirely. It is listed here so §6.4.3's cross-tier guard
   * refuses to diff a tool list against a package surface — the guard is the
   * reason this belongs in the shared enum rather than a parallel one.
   */
  | 'mcp_tools_list';

export type SymbolKind = 'function' | 'class' | 'object' | 'primitive' | 'type_only';

/**
 * `origin` exists because of defect §6.4.1: `export { X } from "@scope/other"`
 * re-exports a symbol this package does not own. Counting those as local surface
 * made one package look like it deleted 168 exports when the true figure was 0.
 * Anything `external:*` is excluded from removal counts.
 */
export type SymbolOrigin = 'local' | `external:${string}`;

export interface SurfaceSymbol {
  /** 'default', 'foo', 'foo.bar' */
  path: string;
  kind: SymbolKind;
  /** `fn.length` equivalent; null when not statically determinable. */
  arity: number | null;
  /**
   * The most arguments the function reads. `null` when unbounded (a rest
   * parameter, or a body that reads `arguments`). Absent when not measured,
   * which is every non-function and every surface read back from storage.
   * With `arity` it gives the range a call has to land in: `(a, b = 1)` has
   * arity 1 and accepts 1–2.
   */
  maxArity?: number | null;
  origin: SymbolOrigin;
  deprecated: boolean;
  tier: ExtractionTier;
  /** Full declaration text. Tier C only — tier A cannot see types, and an
   *  overload set collapses to one symbol whose signature lists each overload. */
  signature?: string;
  /**
   * Where the exported value is declared. `offset` is the declaration's
   * character position: two exports with the same file and offset are one value
   * under two names. The line cannot say that, because a minified bundle
   * declares everything on line 1.
   */
  sourceRef?: { file: string; line: number; offset?: number };
}

export interface ExtractedSurface {
  package: string;
  version: string | null;
  tier: ExtractionTier;
  entry: string | null;
  symbols: SurfaceSymbol[];
  /** Files walked through the package-internal module graph (§6.4.5). */
  filesWalked: number;
  /** Specifiers that resolved outside the package — their names are external. */
  externalReExports: string[];
  /** Set when nothing could be extracted; the caller records UNDECLARED, not absence. */
  undeclaredReason?: string;
}

/** Runtime-existence symbols only: `type_only` never counts (§6.4.4). */
export function runtimeSymbols(surface: ExtractedSurface): SurfaceSymbol[] {
  return surface.symbols.filter((s) => s.kind !== 'type_only' && s.origin === 'local');
}
