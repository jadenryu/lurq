/**
 * `lurq hook <event>`: what Claude Code runs so lurq gets used without the agent
 * having to remember it. Aggressive where a mistake is expensive, measured
 * everywhere else:
 *
 *   session-start  open urgent changes, plus a two-line brief in a JS project
 *   prompt         a tip when the prompt is about choosing, adding or upgrading
 *                  packages, once per kind per session
 *   pre-tool-use   installs, runners and package.json edits are verified first:
 *                  a package that does not exist is denied, a high-risk one asks
 *                  the user, and a clean one gets a single "call usage" nudge
 *
 * An agent told to call verify still skips it when it is sure of the name, and a
 * hallucinated name is exactly when it is sure. So the check is not left to it.
 *
 * It never gets in the way when lurq cannot answer. No key, no session id, a
 * timeout, input it cannot read: no output, exit 0, and Claude Code carries on
 * as if the hook were not there.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { isValidNpmName } from '../benchmark/normalize';
import type { SecurityVerdict } from '../security/verdict';

/** Package manager → the verbs that take package names. */
const MANAGERS = new Map([
  ['npm', new Set(['install', 'i', 'in', 'add'])],
  ['pnpm', new Set(['add', 'install', 'i'])],
  ['yarn', new Set(['add'])],
  ['bun', new Set(['add', 'install', 'i'])],
]);

/** Flags whose next token is a value, never a package. Guessing wrong here only skips a check. */
const VALUE_FLAGS = new Set(['--prefix', '--registry', '--filter', '-F', '-C', '--dir', '--cwd', '--workspace', '-w', '--tag', '--cache', '--userconfig']);

/** Most names verified per command, so a pasted list cannot stall the agent. */
const MAX_NAMES = 10;
const VERIFY_TIMEOUT_MS = 8_000;

/** `zod@^3` → `zod`, `@scope/pkg@1` → `@scope/pkg`. Null for paths, URLs, git, tarballs and aliases. */
export function specName(spec: string): string | null {
  if (/[:/\\]/.test(spec.replace(/^@[^/]+\//, '')) || /\.(tgz|tar|tar\.gz)$/.test(spec)) return null;
  const at = spec.indexOf('@', 1);
  const name = at === -1 ? spec : spec.slice(0, at);
  return isValidNpmName(name) ? name : null;
}

/** The registry packages a shell command would install, deduplicated. */
export function installTargets(command: string): string[] {
  const names = new Set<string>();
  // ponytail: whitespace tokens, no shell quoting; a quoted or scripted install goes unchecked, never wrongly denied.
  for (const segment of command.split(/&&|\|\||[;|\n]/)) {
    const tokens = segment.trim().split(/\s+/);
    let i = 0;
    while (i < tokens.length && (tokens[i] === 'sudo' || /^[A-Za-z_]\w*=/.test(tokens[i]!))) i++;
    if (!MANAGERS.get(tokens[i] ?? '')?.has(tokens[i + 1] ?? '')) continue;
    for (let j = i + 2; j < tokens.length; j++) {
      const t = tokens[j]!;
      if (VALUE_FLAGS.has(t)) j++;
      else if (!t.startsWith('-')) {
        const name = specName(t);
        if (name) names.add(name);
      }
    }
  }
  return [...names];
}

/** Runners that fetch a package to execute it once: the typosquat path that skips `install`. */
const RUNNERS: [string, string | null][] = [
  ['npx', null],
  ['bunx', null],
  ['pnpm', 'dlx'],
  ['yarn', 'dlx'],
];

/**
 * Packages a command would download and run. Names that resolve to a local bin
 * (`npx tsc`, `npx vitest` in a repo that has them) are skipped: those never
 * touch the registry, and `tsc` the package is not the TypeScript compiler.
 */
export function runTargets(command: string, hasLocalBin: (name: string) => boolean = () => false): string[] {
  const names = new Set<string>();
  for (const segment of command.split(/&&|\|\||[;|\n]/)) {
    const tokens = segment.trim().split(/\s+/);
    let i = 0;
    while (i < tokens.length && (tokens[i] === 'sudo' || /^[A-Za-z_]\w*=/.test(tokens[i]!))) i++;
    const runner = RUNNERS.find(([bin, verb]) => tokens[i] === bin && (verb === null || tokens[i + 1] === verb));
    if (!runner) continue;
    for (let j = i + (runner[1] ? 2 : 1); j < tokens.length; j++) {
      const t = tokens[j]!;
      if (t === '-p' || t === '--package') {
        const name = specName(tokens[++j] ?? '');
        if (name) names.add(name);
      } else if (t.startsWith('--package=')) {
        const name = specName(t.slice('--package='.length));
        if (name) names.add(name);
      } else if (!t.startsWith('-')) {
        // The first positional is the command; everything after it is its own arguments.
        const name = specName(t);
        if (name && !hasLocalBin(name)) names.add(name);
        break;
      }
    }
  }
  return [...names];
}

const DEP_FIELDS = ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies'] as const;

/** Registry dependencies `after` declares that `before` did not. Null when either side is not a package.json object. */
export function addedDependencies(before: string, after: string): string[] | null {
  const read = (text: string): Record<string, any> | null => {
    try {
      const v = JSON.parse(text);
      return v && typeof v === 'object' && !Array.isArray(v) ? v : null;
    } catch {
      return null;
    }
  };
  const [was, now] = [read(before || '{}'), read(after)];
  if (!was || !now) return null;
  const had = new Set(DEP_FIELDS.flatMap((f) => Object.keys(was[f] ?? {})));
  const added = new Set<string>();
  for (const field of DEP_FIELDS) {
    for (const [name, range] of Object.entries(now[field] ?? {})) {
      // workspace:, file:, link:, npm: aliases, git and URLs never mean the registry name as written.
      if (had.has(name) || typeof range !== 'string' || /[:/]/.test(range)) continue;
      if (specName(name) === name) added.add(name);
    }
  }
  return [...added];
}

export interface HookDecision {
  permissionDecision: 'deny' | 'ask';
  permissionDecisionReason: string;
}

const clip = (s: string, n = 240) => {
  const line = s.replace(/\s+/g, ' ').trim();
  return line.length > n ? `${line.slice(0, n - 1)}…` : line;
};

/** What Claude Code should do with the install, or null to stay out of the way. */
export function decide(
  checked: { name: string; verdict: SecurityVerdict }[],
  opts: { deny?: boolean } = {},
): HookDecision | null {
  const list = (xs: typeof checked) => xs.map((x) => x.name).join(', ');
  const why = (xs: typeof checked) => xs.map((x) => `${x.name}: ${clip(x.verdict.reasons[0] ?? x.verdict.scope)}`).join('; ');

  // A runner fetching a name that does not exist just fails; only an install or a declared dependency is stopped.
  const invalid = opts.deny === false ? [] : checked.filter((c) => c.verdict.level === 'invalid');
  if (invalid.length) {
    return {
      permissionDecision: 'deny',
      permissionDecisionReason:
        `lurq: ${list(invalid)} ${invalid.length === 1 ? 'is not a real npm package' : 'are not real npm packages'}, ` +
        `so this was stopped before it ran. Check the name for a typo or a package that never existed, and tell the user what lurq found. (${why(invalid)})`,
    };
  }
  const high = checked.filter((c) => c.verdict.level === 'high');
  if (high.length) {
    return {
      permissionDecision: 'ask',
      permissionDecisionReason: `lurq flags ${list(high)} as high risk: ${why(high)}. Run \`lurq verify <package>\` for the evidence.`,
    };
  }
  return null;
}

// ── Measured: once per thing per session ─────────────────────────────────────

/** Keys from `keys` this session has not been nudged about yet, recorded as seen. Empty without a session id. */
export function unseen(sessionId: unknown, keys: string[], dir = join(tmpdir(), 'lurq-hooks')): string[] {
  if (typeof sessionId !== 'string' || !sessionId || keys.length === 0) return [];
  const path = join(dir, `${sessionId.replace(/[^\w-]/g, '').slice(0, 80)}.json`);
  let seen: string[] = [];
  try {
    seen = JSON.parse(readFileSync(path, 'utf8')).seen ?? [];
  } catch {
    // First nudge this session.
  }
  const fresh = [...new Set(keys)].filter((k) => !seen.includes(k));
  if (fresh.length) {
    // ponytail: one small file per session in the OS temp dir, left for the OS to clean.
    mkdirSync(dir, { recursive: true });
    writeFileSync(path, JSON.stringify({ seen: [...seen, ...fresh] }));
  }
  return fresh;
}

/** A JavaScript project: a package.json here or in a parent directory. */
export function isJsProject(cwd: unknown): boolean {
  if (typeof cwd !== 'string' || !cwd) return false;
  for (let dir = cwd; ; dir = dirname(dir)) {
    if (existsSync(join(dir, 'package.json'))) return true;
    if (dirname(dir) === dir) return false;
  }
}

// ── prompt ───────────────────────────────────────────────────────────────────

const PROMPT_TIPS = [
  {
    kind: 'choose',
    test: /\b(which|best|recommend\w*|alternatives?|librar(y|ies)|sdks?|frameworks?)\b/i,
    tip: 'lurq is connected. If this means choosing a library, name the candidates you know and check them with lurq compare (evaluate for one), then verify the pick: your sense of package health is from training, lurq is current.',
  },
  {
    kind: 'upgrade',
    test: /\b(upgrad\w*|bump\w*|migrat\w*|deprecat\w*|breaking|major version|latest version)\b/i,
    tip: 'lurq is connected. For an upgrade, call lurq diff_surface with the package and both versions to see what was removed or changed, and compat for the resulting set, before editing code.',
  },
  {
    kind: 'install',
    test: /\b(install\w*|dependenc(y|ies)|add (a |an |the )?(package|library|dep))\b/i,
    tip: 'lurq is connected. Call lurq verify before adding a package and usage before writing code against one. Installs in this session are also checked automatically.',
  },
] as const;

/** The tips a prompt earns, before the once-per-session cap. */
export function promptTips(prompt: string): { kind: string; tip: string }[] {
  return PROMPT_TIPS.filter((t) => t.test.test(prompt)).map(({ kind, tip }) => ({ kind, tip }));
}

// ── pre-tool-use ─────────────────────────────────────────────────────────────

type Edit = { old_string?: unknown; new_string?: unknown; replace_all?: unknown };

/** The file after Claude Code's Edit/MultiEdit replacements, or null when one would not apply. */
export function applyEdits(text: string, edits: Edit[]): string | null {
  let out = text;
  for (const e of edits) {
    if (typeof e.old_string !== 'string' || typeof e.new_string !== 'string' || !out.includes(e.old_string)) return null;
    out = e.replace_all ? out.split(e.old_string).join(e.new_string) : out.replace(e.old_string, () => e.new_string as string);
  }
  return out;
}

interface ToolInput {
  command?: unknown;
  file_path?: unknown;
  content?: unknown;
  edits?: unknown;
  old_string?: unknown;
  new_string?: unknown;
  replace_all?: unknown;
}

/** What a tool call would install (deny-able) and run (ask-only). */
function targets(tool: unknown, input: ToolInput, cwd: string): { installs: string[]; runs: string[] } {
  if (tool === 'Bash' && typeof input.command === 'string') {
    return {
      installs: installTargets(input.command),
      runs: runTargets(input.command, (n) => existsSync(join(cwd, 'node_modules', '.bin', n))),
    };
  }
  if (typeof input.file_path !== 'string' || basename(input.file_path) !== 'package.json') return { installs: [], runs: [] };
  const before = existsSync(input.file_path) ? readFileSync(input.file_path, 'utf8') : '';
  const after =
    tool === 'Write'
      ? typeof input.content === 'string' ? input.content : null
      : tool === 'Edit'
        ? applyEdits(before, [input])
        : tool === 'MultiEdit' && Array.isArray(input.edits)
          ? applyEdits(before, input.edits as Edit[])
          : null;
  return { installs: after === null ? [] : (addedDependencies(before, after) ?? []), runs: [] };
}

async function preToolUse(input: Record<string, any>): Promise<Record<string, unknown> | null> {
  const cwd = typeof input.cwd === 'string' ? input.cwd : process.cwd();
  const { installs, runs } = targets(input.tool_name, input.tool_input ?? {}, cwd);
  const names = [...new Set([...installs, ...runs])].slice(0, MAX_NAMES);
  if (names.length === 0) return null;

  const { callTool } = await import('./remote');
  const settled = await Promise.allSettled(
    names.map((name) =>
      callTool<{ verdict?: SecurityVerdict }>('verify', { package: name }, { timeoutMs: VERIFY_TIMEOUT_MS }).then(
        (r) => ({ name, verdict: r.verdict }),
      ),
    ),
  );
  const checked = settled.flatMap((s) =>
    s.status === 'fulfilled' && s.value.verdict ? [{ name: s.value.name, verdict: s.value.verdict }] : [],
  );
  const installed = checked.filter((c) => installs.includes(c.name));
  const decision = decide(installed) ?? decide(checked.filter((c) => !installs.includes(c.name)), { deny: false });
  if (decision) return { hookEventName: 'PreToolUse', ...decision };

  const clean = installed.filter((c) => c.verdict.level !== 'invalid' && c.verdict.level !== 'high').map((c) => c.name);
  const fresh = unseen(input.session_id, clean.map((n) => `usage:${n}`)).map((k) => k.slice('usage:'.length));
  if (fresh.length === 0) return null;
  return {
    hookEventName: 'PreToolUse',
    additionalContext: `lurq verified ${fresh.join(', ')} before this ran. Before writing code against ${fresh.length === 1 ? 'it' : 'them'}, call lurq usage with ${fresh.length === 1 ? 'it' : 'each'} (with knownVersion if you remember one): APIs move, and what you remember is from training.`,
  };
}

// ── session-start ────────────────────────────────────────────────────────────

const BRIEF =
  'lurq is connected to this session: package installs and package.json dependency edits are verified automatically. ' +
  'Call lurq usage before writing code against a package API you know from training, and compare or evaluate when choosing a package.';

async function sessionStart(input: Record<string, any>): Promise<Record<string, unknown> | null> {
  const { apiKey, getAlerts } = await import('./remote');
  apiKey(); // No key, no lurq tools: say nothing rather than advertise ones that will fail.
  const alerts = await getAlerts({ timeoutMs: 3_000 }).catch(() => null);
  const text = [isJsProject(input.cwd) ? BRIEF : null, alerts].filter(Boolean).join('\n\n');
  return text ? { hookEventName: 'SessionStart', additionalContext: text } : null;
}

// ── entry ────────────────────────────────────────────────────────────────────

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString('utf8');
}

export const HOOK_EVENTS = ['session-start', 'prompt', 'pre-tool-use'] as const;

export async function runHook(event: string): Promise<void> {
  try {
    const input = JSON.parse(await readStdin()) as Record<string, any>;
    let output: Record<string, unknown> | null = null;
    if (event === 'pre-tool-use') output = await preToolUse(input);
    else if (event === 'session-start') output = await sessionStart(input);
    else if (event === 'prompt' && typeof input.prompt === 'string' && isJsProject(input.cwd)) {
      const tips = promptTips(input.prompt);
      const fresh = new Set(unseen(input.session_id, tips.map((t) => t.kind)));
      const text = tips.filter((t) => fresh.has(t.kind)).map((t) => t.tip).join('\n');
      if (text) output = { hookEventName: 'UserPromptSubmit', additionalContext: text };
    }
    if (output) process.stdout.write(JSON.stringify({ hookSpecificOutput: output }));
  } catch {
    // Unreadable input or no key: lurq never blocks work it cannot judge.
  }
}
