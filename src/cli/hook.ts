/**
 * `lurq hook [--agent claude|codex|cursor] <event>`: what an agent runs so lurq
 * gets used without the agent having to remember it. Aggressive where a mistake
 * is expensive, measured everywhere else:
 *
 *   session-start  open urgent changes, plus a two-line brief in a JS project
 *   prompt         a tip when the prompt is about choosing, adding or upgrading
 *                  packages, once per kind per session (Claude Code, Codex)
 *   pre-tool-use   installs, runners and package.json edits are verified first:
 *                  a package that does not exist is denied, a high-risk one asks
 *                  the user, and a clean one gets a single "call usage" nudge
 *   post-tool-use  Cursor only: the usage nudge, after the install succeeded
 *
 * An agent told to call verify still skips it when it is sure of the name, and a
 * hallucinated name is exactly when it is sure. So the check is not left to it.
 *
 * The three agents share one event model with different wire formats: Codex
 * copies Claude Code's (minus "ask", and edits arrive as apply_patch), Cursor
 * renames everything. `normalize` and `render` are the only places that differ.
 *
 * It never gets in the way when lurq cannot answer. No key, no session id, a
 * timeout, input it cannot read: no output, exit 0, and the agent carries on as
 * if the hook were not there.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, isAbsolute, join } from 'node:path';
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
const VALUE_FLAGS = new Set([
  '--prefix',
  '--registry',
  '--filter',
  '-F',
  '-C',
  '--dir',
  '--cwd',
  '--workspace',
  '-w',
  '--tag',
  '--cache',
  '--userconfig',
]);

/** Most names verified per command, so a pasted list cannot stall the agent. */
const MAX_NAMES = 10;
const VERIFY_TIMEOUT_MS = 8_000;

/** `zod@^3` → `zod`, `@scope/pkg@1` → `@scope/pkg`. Null for paths, URLs, git, tarballs and aliases. */
export function specName(spec: string): string | null {
  if (/[:/\\]/.test(spec.replace(/^@[^/]+\//, '')) || /\.(tgz|tar|tar\.gz)$/.test(spec))
    return null;
  const at = spec.indexOf('@', 1);
  const name = at === -1 ? spec : spec.slice(0, at);
  return isValidNpmName(name) ? name : null;
}

/** Set on a command the user approved after lurq flagged it, where the agent has no "ask" (Codex). */
export const ALLOW_ENV = 'LURQ_ALLOW=1';

/** Index of the program in a command's tokens, past `sudo` and env assignments. -1 when the user waved lurq through. */
function commandStart(tokens: string[]): number {
  let i = 0;
  while (i < tokens.length && (tokens[i] === 'sudo' || /^[A-Za-z_]\w*=/.test(tokens[i]!))) {
    if (tokens[i] === ALLOW_ENV) return -1;
    i++;
  }
  return i;
}

/** The registry packages a shell command would install, deduplicated. */
export function installTargets(command: string): string[] {
  const names = new Set<string>();
  // ponytail: whitespace tokens, no shell quoting; a quoted or scripted install goes unchecked, never wrongly denied.
  for (const segment of command.split(/&&|\|\||[;|\n]/)) {
    const tokens = segment.trim().split(/\s+/);
    const i = commandStart(tokens);
    if (i === -1) continue;
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
export function runTargets(
  command: string,
  hasLocalBin: (name: string) => boolean = () => false,
): string[] {
  const names = new Set<string>();
  for (const segment of command.split(/&&|\|\||[;|\n]/)) {
    const tokens = segment.trim().split(/\s+/);
    const i = commandStart(tokens);
    if (i === -1) continue;
    const runner = RUNNERS.find(
      ([bin, verb]) => tokens[i] === bin && (verb === null || tokens[i + 1] === verb),
    );
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

const DEP_FIELDS = [
  'dependencies',
  'devDependencies',
  'peerDependencies',
  'optionalDependencies',
] as const;

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
  const why = (xs: typeof checked) =>
    xs.map((x) => `${x.name}: ${clip(x.verdict.reasons[0] ?? x.verdict.scope)}`).join('; ');

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
export function unseen(
  sessionId: unknown,
  keys: string[],
  dir = join(tmpdir(), 'lurq-hooks'),
): string[] {
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
    if (
      typeof e.old_string !== 'string' ||
      typeof e.new_string !== 'string' ||
      !out.includes(e.old_string)
    )
      return null;
    out = e.replace_all
      ? out.split(e.old_string).join(e.new_string)
      : out.replace(e.old_string, () => e.new_string as string);
  }
  return out;
}

const readIfExists = (path: string): string => (existsSync(path) ? readFileSync(path, 'utf8') : '');

/**
 * Each package.json a Codex `apply_patch` adds or updates, as before/after text.
 * A hunk is applied as an exact replacement of its context and removed lines, the
 * way Edit is; a hunk that does not apply drops that file, so it goes unchecked
 * rather than wrongly checked.
 */
export function patchedPackageJsons(
  patch: string,
  cwd: string,
  read = readIfExists,
): { before: string; after: string }[] {
  const files: { before: string; after: string }[] = [];
  for (const section of patch.split(/^\*\*\* (?=(?:Add|Update|Delete) File: )/m).slice(1)) {
    const [header = '', ...rest] = section.split('\n');
    const m = /^(Add|Update) File: (.+)$/.exec(header.trim());
    if (!m || basename(m[2]!) !== 'package.json') continue;
    const body = rest.filter((l) => !l.startsWith('*** '));
    if (m[1] === 'Add') {
      files.push({
        before: '',
        after: body
          .filter((l) => l.startsWith('+'))
          .map((l) => l.slice(1))
          .join('\n'),
      });
      continue;
    }
    const before = read(isAbsolute(m[2]!) ? m[2]! : join(cwd, m[2]!));
    // ponytail: a bare empty line inside a hunk is dropped, so that hunk fails to apply and the file goes unchecked.
    const edits = body
      .join('\n')
      .split(/^@@.*$/m)
      .map((h) => h.split('\n').filter((l) => /^[ +-]/.test(l)))
      .filter((h) => h.length > 0)
      .map((h) => ({
        old_string: h
          .filter((l) => !l.startsWith('+'))
          .map((l) => l.slice(1))
          .join('\n'),
        new_string: h
          .filter((l) => !l.startsWith('-'))
          .map((l) => l.slice(1))
          .join('\n'),
      }));
    const after = applyEdits(before, edits);
    if (after !== null) files.push({ before, after });
  }
  return files;
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
function targets(
  tool: unknown,
  input: ToolInput,
  cwd: string,
): { installs: string[]; runs: string[] } {
  const none = { installs: [], runs: [] };
  if (typeof input.command === 'string' && tool === 'Bash') {
    return {
      installs: installTargets(input.command),
      runs: runTargets(input.command, (n) => existsSync(join(cwd, 'node_modules', '.bin', n))),
    };
  }
  if (typeof input.command === 'string' && tool === 'apply_patch') {
    const installs = patchedPackageJsons(input.command, cwd).flatMap(
      (f) => addedDependencies(f.before, f.after) ?? [],
    );
    return { installs: [...new Set(installs)], runs: [] };
  }
  if (typeof input.file_path !== 'string' || basename(input.file_path) !== 'package.json')
    return none;
  const before = readIfExists(input.file_path);
  const after =
    tool === 'Write'
      ? typeof input.content === 'string'
        ? input.content
        : null
      : tool === 'Edit'
        ? applyEdits(before, [input])
        : tool === 'MultiEdit' && Array.isArray(input.edits)
          ? applyEdits(before, input.edits as Edit[])
          : null;
  return { installs: after === null ? [] : (addedDependencies(before, after) ?? []), runs: [] };
}

/** What a hook has to say, before it is put in an agent's wire format. */
export interface Outcome {
  decision?: HookDecision;
  context?: string;
}

const usageNudge = (names: string[]) =>
  `Before writing code against ${names.join(', ')}, call lurq usage with ${names.length === 1 ? 'it' : 'each'} (with knownVersion if you remember one): APIs move, and what you remember is from training.`;

/** The usage nudge for names this session has not been nudged about. */
function freshUsage(sessionId: unknown, names: string[]): string[] {
  return unseen(
    sessionId,
    names.map((n) => `usage:${n}`),
  ).map((k) => k.slice('usage:'.length));
}

async function preToolUse(input: Record<string, any>, nudge: boolean): Promise<Outcome | null> {
  const cwd = typeof input.cwd === 'string' ? input.cwd : process.cwd();
  const { installs, runs } = targets(input.tool_name, input.tool_input ?? {}, cwd);
  const names = [...new Set([...installs, ...runs])].slice(0, MAX_NAMES);
  if (names.length === 0) return null;

  const { callTool } = await import('./remote');
  const settled = await Promise.allSettled(
    names.map((name) =>
      callTool<{ verdict?: SecurityVerdict }>(
        'verify',
        { package: name },
        { timeoutMs: VERIFY_TIMEOUT_MS },
      ).then((r) => ({ name, verdict: r.verdict })),
    ),
  );
  const checked = settled.flatMap((s) =>
    s.status === 'fulfilled' && s.value.verdict
      ? [{ name: s.value.name, verdict: s.value.verdict }]
      : [],
  );
  const installed = checked.filter((c) => installs.includes(c.name));
  const decision =
    decide(installed) ??
    decide(
      checked.filter((c) => !installs.includes(c.name)),
      { deny: false },
    );
  if (decision) return { decision };
  if (!nudge) return null;

  const clean = installed
    .filter((c) => c.verdict.level !== 'invalid' && c.verdict.level !== 'high')
    .map((c) => c.name);
  const fresh = freshUsage(input.session_id, clean);
  return fresh.length
    ? { context: `lurq verified ${fresh.join(', ')} before this ran. ${usageNudge(fresh)}` }
    : null;
}

/** Cursor's nudge, once the install has run (its pre-shell hook cannot add context). */
function postToolUse(input: Record<string, any>): Outcome | null {
  const command = input.tool_input?.command;
  if (typeof command !== 'string') return null;
  const fresh = freshUsage(input.session_id, installTargets(command));
  return fresh.length
    ? { context: `lurq checked ${fresh.join(', ')} before install. ${usageNudge(fresh)}` }
    : null;
}

// ── session-start ────────────────────────────────────────────────────────────

const brief = (agent: HookAgent) =>
  `lurq is connected to this session: package installs${agent === 'cursor' ? '' : ' and package.json dependency edits'} are verified automatically. ` +
  'Call lurq usage before writing code against a package API you know from training, and compare or evaluate when choosing a package.';

async function sessionStart(input: Record<string, any>, agent: HookAgent): Promise<Outcome | null> {
  const { apiKey, getAlerts } = await import('./remote');
  apiKey(); // No key, no lurq tools: say nothing rather than advertise ones that will fail.
  // The agent rides along so session starts can be told apart by agent, named the way setup names it.
  const alerts = await getAlerts({
    timeoutMs: 3_000,
    agent: agent === 'claude' ? 'claude-code' : agent,
  }).catch(() => null);
  const text = [isJsProject(input.cwd) ? brief(agent) : null, alerts].filter(Boolean).join('\n\n');
  return text ? { context: text } : null;
}

function prompt(input: Record<string, any>): Outcome | null {
  if (typeof input.prompt !== 'string' || !isJsProject(input.cwd)) return null;
  const tips = promptTips(input.prompt);
  const fresh = new Set(
    unseen(
      input.session_id,
      tips.map((t) => t.kind),
    ),
  );
  const text = tips
    .filter((t) => fresh.has(t.kind))
    .map((t) => t.tip)
    .join('\n');
  return text ? { context: text } : null;
}

// ── wire formats ─────────────────────────────────────────────────────────────

export const HOOK_AGENTS = ['claude', 'codex', 'cursor'] as const;
export type HookAgent = (typeof HOOK_AGENTS)[number];

/** Cursor's input in Claude Code's field names: `conversation_id`, `workspace_roots`, a bare shell `command`. */
export function normalize(agent: HookAgent, input: Record<string, any>): Record<string, any> {
  if (agent !== 'cursor') return input;
  const command = typeof input.command === 'string' ? input.command : input.tool_input?.command;
  return {
    session_id: input.conversation_id ?? input.session_id,
    cwd: input.cwd ?? input.workspace_roots?.[0],
    ...(typeof command === 'string' ? { tool_name: 'Bash', tool_input: { command } } : {}),
  };
}

const CLAUDE_EVENT: Record<string, string> = {
  'session-start': 'SessionStart',
  prompt: 'UserPromptSubmit',
  'pre-tool-use': 'PreToolUse',
};

/** An outcome in the agent's wire format, or null for no output. */
export function render(
  agent: HookAgent,
  event: string,
  outcome: Outcome | null,
): Record<string, unknown> | null {
  if (!outcome) return null;
  const { decision, context } = outcome;
  if (agent === 'cursor') {
    if (decision) {
      const message = decision.permissionDecisionReason;
      return {
        permission: decision.permissionDecision,
        user_message: message,
        agent_message: message,
      };
    }
    return context ? { additional_context: context } : null;
  }
  const hookEventName = CLAUDE_EVENT[event];
  if (!hookEventName) return null;
  if (decision) {
    // Codex parses "ask" but does not support it, and runs the command anyway. Deny, and say how the user approves.
    const asCodex =
      agent === 'codex' && decision.permissionDecision === 'ask'
        ? {
            permissionDecision: 'deny',
            permissionDecisionReason: `${decision.permissionDecisionReason} Tell the user what lurq found. Only if they approve, run the install again prefixed with ${ALLOW_ENV}.`,
          }
        : decision;
    return { hookSpecificOutput: { hookEventName, ...asCodex } };
  }
  return context ? { hookSpecificOutput: { hookEventName, additionalContext: context } } : null;
}

// ── entry ────────────────────────────────────────────────────────────────────

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString('utf8');
}

export async function runHook(event: string, agentName = 'claude'): Promise<void> {
  try {
    const agent = HOOK_AGENTS.find((a) => a === agentName);
    if (!agent) return;
    const input = normalize(agent, JSON.parse(await readStdin()) as Record<string, any>);
    const outcome =
      event === 'pre-tool-use'
        ? await preToolUse(input, agent !== 'cursor')
        : event === 'post-tool-use'
          ? postToolUse(input)
          : event === 'session-start'
            ? await sessionStart(input, agent)
            : event === 'prompt'
              ? prompt(input)
              : null;
    const output = render(agent, event, outcome);
    if (output) process.stdout.write(JSON.stringify(output));
  } catch {
    // Unreadable input or no key: lurq never blocks work it cannot judge.
  }
}
