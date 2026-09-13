/**
 * `lurq hook pre-tool-use`: Claude Code runs this before every Bash command.
 *
 * An agent told to call verify before installing still skips it when it is sure
 * of the name, and a hallucinated name is exactly when it is sure. The hook takes
 * the choice away: the install command itself gets checked.
 *
 * It never gets in the way when lurq cannot answer. No key, a timeout, a command
 * it cannot read: no output, exit 0, and Claude Code carries on as if the hook
 * were not there. Only a verdict speaks:
 *   - not a real package → deny, and the reason goes back to the agent
 *   - high risk          → ask, so the user decides
 * Everything else is silent.
 */
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
        `so this install was stopped. Check the name for a typo or a package that never existed, and tell the user what lurq found. (${why(invalid)})`,
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

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString('utf8');
}

export async function runHook(event: string): Promise<void> {
  if (event !== 'pre-tool-use') return;
  try {
    const input = JSON.parse(await readStdin()) as { tool_input?: { command?: unknown } };
    const command = input.tool_input?.command;
    if (typeof command !== 'string') return;
    const names = installTargets(command).slice(0, MAX_NAMES);
    if (names.length === 0) return;

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
    const decision = decide(checked);
    if (decision) process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: 'PreToolUse', ...decision } }));
  } catch {
    // Unreadable input or no key: lurq never blocks work it cannot judge.
  }
}
