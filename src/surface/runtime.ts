/**
 * Tier B — sandboxed runtime import (§6.2).
 *
 * Installs the package and its dependencies, imports it, and enumerates the real
 * exported names with `Object.getOwnPropertyNames`, capturing genuine `fn.length`
 * arity. This is ground truth for "does the symbol exist", and it is also the
 * dominant cost in the pipeline by an order of magnitude — reserve it for
 * packages tier A cannot resolve, and for the §7 validation sample.
 *
 * §6.4.2 is the defect this file exists to not repeat. The original harness read
 * `process.argv[1]` — the loader script — instead of the target module, so every
 * module enumerated as empty and every finding was "confirmed" at a vacuous 100%
 * precision. Two guards, both mandatory:
 *   1. the probe requires the TARGET BY NAME, never a path derived from argv
 *   2. an empty enumeration is reported as UNVERIFIABLE, never as an empty surface
 */
import type { Sandbox } from '../sandbox/types';
import type { ExtractedSurface, SurfaceSymbol, SymbolKind } from './types';

const TIER = 'runtime_import' as const;
const IMPORT_TIMEOUT_MS = 90_000;

interface ProbeSymbol {
  path: string;
  kind: SymbolKind;
  arity: number | null;
}

interface ProbeResult {
  ok: boolean;
  error?: string;
  /** True when the module loaded but exposed nothing enumerable. */
  empty?: boolean;
  symbols?: ProbeSymbol[];
}

/**
 * The probe, run inside the sandbox. Requires the package BY NAME — the §6.4.2
 * guard — and reports emptiness explicitly rather than returning `[]`, so the
 * caller can tell "loaded and exposed nothing" from "never loaded".
 */
function runtimeProbeScript(pkgName: string): string {
  return `
const out = (o) => { process.stdout.write("@@LURQ@@" + JSON.stringify(o) + "\\n", () => process.exit(0)); };
let mod;
try {
  mod = require(${JSON.stringify(pkgName)});
} catch (e) {
  out({ ok: false, error: String((e && e.message) || e).slice(0, 400) });
}
try {
  const kindOf = (v) => {
    const t = typeof v;
    if (t === "function") return /^\\s*class[\\s{]/.test(Function.prototype.toString.call(v)) ? "class" : "function";
    if (v && t === "object") return "object";
    if (v === null || v === undefined) return "primitive";
    return "primitive";
  };
  const symbols = [];
  const seen = new Set();
  const push = (name, v) => {
    if (seen.has(name)) return;
    seen.add(name);
    let arity = null;
    try { if (typeof v === "function") arity = v.length; } catch (_) {}
    symbols.push({ path: name, kind: kindOf(v), arity });
  };
  if (typeof mod === "function") push("default", mod);
  if (mod && (typeof mod === "object" || typeof mod === "function")) {
    for (const name of Object.getOwnPropertyNames(mod)) {
      if (name === "__esModule") continue;
      let v;
      try { v = mod[name]; } catch (_) { v = undefined; }
      push(name, v);
    }
  } else if (mod !== undefined) {
    push("default", mod);
  }
  out({ ok: true, empty: symbols.length === 0, symbols });
} catch (e) {
  out({ ok: false, error: String((e && e.message) || e).slice(0, 400) });
}
`.trim();
}

/** Pull the probe line out of stdout the package may also have written to. */
function parseRuntimeProbe(stdout: string): ProbeResult | null {
  const marker = '@@LURQ@@';
  const idx = stdout.lastIndexOf(marker);
  if (idx < 0) return null;
  const line = stdout.slice(idx + marker.length).split('\n')[0]!.trim();
  try {
    const parsed = JSON.parse(line) as ProbeResult;
    return typeof parsed.ok === 'boolean' ? parsed : null;
  } catch {
    return null;
  }
}

export interface RuntimeSurfaceResult {
  surface: ExtractedSurface;
  /** Set when no verdict may be drawn — infrastructure, not a fact about the package. */
  unverifiable?: string;
}

/**
 * Enumerate a package's real runtime exports.
 *
 * Never returns an empty symbol list as if it were a finding: a module that
 * loads but exposes nothing comes back `unverifiable`, because in practice that
 * means the probe was wrong far more often than the package was.
 */
export async function extractRuntimeSurface(
  pkg: string,
  version: string | null,
  sandbox: Sandbox,
): Promise<RuntimeSurfaceResult> {
  const base: ExtractedSurface = {
    package: pkg,
    version,
    tier: TIER,
    entry: null,
    symbols: [],
    filesWalked: 0,
    externalReExports: [],
  };

  let stdout: string;
  try {
    const res = await sandbox.exec(`node -e ${shQuote(runtimeProbeScript(pkg))}`, {
      install: [{ name: pkg, version }],
      timeoutMs: IMPORT_TIMEOUT_MS,
    });
    stdout = res.stdout;
  } catch (err) {
    return { surface: base, unverifiable: `sandbox failure: ${String(err).slice(0, 200)}` };
  }

  const probe = parseRuntimeProbe(stdout);
  if (!probe) return { surface: base, unverifiable: 'probe produced no parseable output' };
  if (!probe.ok) {
    // The package genuinely failed to import — that IS a fact about it.
    return { surface: { ...base, undeclaredReason: `import failed: ${probe.error ?? 'unknown'}` } };
  }
  // §6.4.2 — an empty enumeration must never become a verdict.
  if (probe.empty) return { surface: base, unverifiable: 'runtime surface enumerated empty' };

  const symbols: SurfaceSymbol[] = (probe.symbols ?? []).map((s) => ({
    path: s.path,
    kind: s.kind,
    arity: s.arity,
    origin: 'local',
    deprecated: false,
    tier: TIER,
  }));
  return { surface: { ...base, symbols } };
}

/** POSIX single-quote for embedding the probe in a shell command. */
function shQuote(s: string): string {
  return `'${s.replace(/'/g, `'\\''`)}'`;
}
