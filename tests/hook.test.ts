/**
 * The Claude Code install hook: which commands it reads, what it decides, and
 * that setup merges it into the user's settings without disturbing their hooks.
 */
import { describe, expect, it } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  addedDependencies,
  applyEdits,
  decide,
  installTargets,
  isJsProject,
  normalize,
  patchedPackageJsons,
  promptTips,
  render,
  runTargets,
  specName,
  unseen,
} from '../src/cli/hook';
import { hasLurqHooks, withLurqHooks, withoutLurqHooks } from '../src/cli/installSkill';
import type { SecurityVerdict } from '../src/security/verdict';

const verdict = (level: SecurityVerdict['level'], reasons: string[] = []): SecurityVerdict => ({
  level,
  reasons,
  unknowns: [],
  complete: true,
  reassuring: level === 'low' && reasons.length === 0,
  advisoryCount: 0,
  scope: 'the latest version',
});

describe('installTargets', () => {
  it('reads names from every package manager and strips versions', () => {
    expect(installTargets('npm install zod@^3 -D @tanstack/react-query@5')).toEqual([
      'zod',
      '@tanstack/react-query',
    ]);
    expect(installTargets('cd apps/web && pnpm add --filter web lodahs')).toEqual(['lodahs']);
    expect(installTargets('CI=1 yarn add left-pad; bun i hono')).toEqual(['left-pad', 'hono']);
  });

  it('ignores installs with no names, paths, git, tarballs, aliases and non-install commands', () => {
    expect(installTargets('npm install')).toEqual([]);
    expect(
      installTargets(
        'npm i ./local ../x file:../y github:a/b a/b https://x.io/p.tgz pkg.tgz foo@npm:bar',
      ),
    ).toEqual([]);
    expect(installTargets('echo npm i zod')).toEqual([]);
    expect(installTargets('npm run build && git status')).toEqual([]);
  });

  it('keeps a scoped name intact', () => {
    expect(specName('@scope/pkg@1.2.3')).toBe('@scope/pkg');
    expect(specName('@scope/pkg')).toBe('@scope/pkg');
  });
});

describe('decide', () => {
  it('denies a package that does not exist, over anything else', () => {
    const d = decide([
      { name: 'zod', verdict: verdict('high', ['2 critical advisories']) },
      { name: 'lodahs', verdict: verdict('invalid', ['no such package on npm']) },
    ]);
    expect(d?.permissionDecision).toBe('deny');
    expect(d?.permissionDecisionReason).toContain('lodahs is not a real npm package');
  });

  it('asks on high risk and stays silent otherwise', () => {
    expect(
      decide([{ name: 'evil', verdict: verdict('high', ['install script\nreads ~/.ssh']) }]),
    ).toEqual({
      permissionDecision: 'ask',
      permissionDecisionReason:
        'lurq flags evil as high risk: evil: install script reads ~/.ssh. Run `lurq verify <package>` for the evidence.',
    });
    expect(
      decide([
        { name: 'zod', verdict: verdict('medium', ['deprecated']) },
        { name: 'hono', verdict: verdict('low') },
      ]),
    ).toBeNull();
    expect(decide([])).toBeNull();
  });
});

describe('Claude Code settings', () => {
  const user = {
    model: 'opus',
    hooks: {
      PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: 'my-guard' }] }],
      Stop: [],
    },
  };

  it('adds each hook after the user’s, idempotently, and removes them back to the original', () => {
    const once = withLurqHooks(user, 'claude', 'lurq');
    expect(withLurqHooks(once, 'claude', 'lurq')).toEqual(once);
    expect(hasLurqHooks(once)).toBe(true);
    expect(once.hooks.PreToolUse).toHaveLength(2);
    expect(once.hooks.PreToolUse[1]).toEqual({
      matcher: 'Bash|Edit|Write|MultiEdit',
      hooks: [{ type: 'command', command: 'lurq hook pre-tool-use', timeout: 30 }],
    });
    expect(once.hooks.SessionStart[0].hooks[0].command).toBe('lurq hook session-start');
    expect(once.hooks.UserPromptSubmit[0]).not.toHaveProperty('matcher');
    expect(once.hooks.Stop).toEqual([]);
    expect(withoutLurqHooks(once)).toEqual(user);
  });

  it('leaves no empty hooks object behind when ours was the only one', () => {
    expect(withoutLurqHooks(withLurqHooks({}, 'claude', 'lurq'))).toEqual({});
    expect(withoutLurqHooks(user)).toBe(user);
  });
});

describe('runTargets', () => {
  it('reads the package a runner fetches, not its arguments', () => {
    expect(runTargets('npx -y create-next-app@latest my-app --ts')).toEqual(['create-next-app']);
    expect(runTargets('pnpm dlx shadcn@latest add button && bunx cowsay hi')).toEqual([
      'shadcn',
      'cowsay',
    ]);
    expect(runTargets('npx -p @scope/tool --package=other run-it')).toEqual([
      '@scope/tool',
      'other',
      'run-it',
    ]);
  });

  it('skips local bins and commands that are not runners', () => {
    expect(runTargets('npx tsc --noEmit', (n) => n === 'tsc')).toEqual([]);
    expect(runTargets('pnpm exec vitest && yarn build')).toEqual([]);
  });
});

describe('addedDependencies', () => {
  const pkg = (deps: Record<string, string>, dev: Record<string, string> = {}) =>
    JSON.stringify({ name: 'app', dependencies: deps, devDependencies: dev });

  it('lists only registry names that were not declared before', () => {
    expect(
      addedDependencies(pkg({ zod: '^3' }), pkg({ zod: '^4', hono: '^4' }, { lodahs: '1.0.0' })),
    ).toEqual(['hono', 'lodahs']);
    expect(addedDependencies('', pkg({ zod: '^3' }))).toEqual(['zod']);
  });

  it('ignores workspace, file, git and alias ranges, and unparseable files', () => {
    expect(
      addedDependencies(
        pkg({}),
        pkg({ a: 'workspace:*', b: 'file:../b', c: 'github:x/c', d: 'npm:zod@3' }),
      ),
    ).toEqual([]);
    expect(addedDependencies(pkg({}), '{ "dependencies": { oops')).toBeNull();
  });
});

describe('decide for runners', () => {
  it('never denies a missing name, still asks on high risk', () => {
    expect(
      decide([{ name: 'nope', verdict: verdict('invalid', ['no such package']) }], { deny: false }),
    ).toBeNull();
    expect(
      decide([{ name: 'evil', verdict: verdict('high', ['bad']) }], { deny: false })
        ?.permissionDecision,
    ).toBe('ask');
  });
});

describe('measured nudges', () => {
  it('nudges about each thing once per session, and never without a session id', () => {
    const dir = mkdtempSync(join(tmpdir(), 'lurq-hook-state-'));
    expect(unseen('s1', ['usage:zod', 'usage:hono'], dir)).toEqual(['usage:zod', 'usage:hono']);
    expect(unseen('s1', ['usage:zod', 'usage:ky'], dir)).toEqual(['usage:ky']);
    expect(unseen('s2', ['usage:zod'], dir)).toEqual(['usage:zod']);
    expect(unseen(undefined, ['usage:zod'], dir)).toEqual([]);
  });

  it('tips only prompts about choosing, adding or upgrading packages', () => {
    expect(promptTips('which library should I use for dates?').map((t) => t.kind)).toEqual([
      'choose',
    ]);
    expect(promptTips('upgrade next to 16 and install zod').map((t) => t.kind)).toEqual([
      'upgrade',
      'install',
    ]);
    expect(promptTips('fix the flaky login test')).toEqual([]);
  });

  it('knows a JS project from a package.json up the tree', () => {
    expect(isJsProject(join(process.cwd(), 'src', 'cli'))).toBe(true);
    expect(isJsProject(mkdtempSync(join(tmpdir(), 'lurq-not-js-')))).toBe(false);
  });

  it('applies Edit replacements the way Claude Code would, or gives up', () => {
    expect(applyEdits('{"a":1}', [{ old_string: '"a":1', new_string: '"a":1,"b":2' }])).toBe(
      '{"a":1,"b":2}',
    );
    expect(applyEdits('x x', [{ old_string: 'x', new_string: '$&y', replace_all: true }])).toBe(
      '$&y $&y',
    );
    expect(applyEdits('{}', [{ old_string: 'missing', new_string: 'y' }])).toBeNull();
  });
});

describe('Codex and Cursor hook files', () => {
  it('nests Codex hooks like Claude Code, with the agent flag', () => {
    const codex = withLurqHooks({}, 'codex', 'lurq');
    expect(codex.hooks.PreToolUse).toEqual([
      {
        matcher: 'Bash|apply_patch',
        hooks: [{ type: 'command', command: 'lurq hook --agent codex pre-tool-use', timeout: 30 }],
      },
    ]);
    expect(withoutLurqHooks(codex)).toEqual({});
  });

  it('writes Cursor’s flat entries with a schema version, and takes them back out', () => {
    const user = { version: 1, hooks: { afterFileEdit: [{ command: './format.sh' }] } };
    const cursor = withLurqHooks(user, 'cursor', '"/Users/me/.npm global/bin/lurq"');
    expect(cursor.hooks.beforeShellExecution).toEqual([
      { command: '"/Users/me/.npm global/bin/lurq" hook --agent cursor pre-tool-use', timeout: 30 },
    ]);
    expect(cursor.hooks.postToolUse[0].matcher).toBe('Shell');
    expect(withLurqHooks({}, 'cursor', 'lurq').version).toBe(1);
    expect(withoutLurqHooks(cursor)).toEqual(user);
  });
});

describe('patchedPackageJsons (Codex apply_patch)', () => {
  const pkg = '{\n  "name": "app",\n  "dependencies": {\n    "zod": "^3.0.0"\n  }\n}\n';
  const read = () => pkg;

  it('applies an update hunk to package.json and finds the added dependency', () => {
    const patch =
      '*** Begin Patch\n*** Update File: package.json\n@@\n   "dependencies": {\n+    "lodahs": "^1.0.0",\n     "zod": "^3.0.0"\n*** Update File: src/index.ts\n@@\n-a\n+b\n*** End Patch';
    const files = patchedPackageJsons(patch, '/repo', read);
    expect(files).toHaveLength(1);
    expect(addedDependencies(files[0]!.before, files[0]!.after)).toEqual(['lodahs']);
  });

  it('reads an added package.json, and skips a hunk that does not apply', () => {
    const add =
      '*** Begin Patch\n*** Add File: packages/x/package.json\n+{"dependencies":{"hono":"^4"}}\n*** End Patch';
    expect(addedDependencies('', patchedPackageJsons(add, '/repo', read)[0]!.after)).toEqual([
      'hono',
    ]);
    const stale =
      '*** Begin Patch\n*** Update File: package.json\n@@\n-    "nope": "1"\n+    "ky": "1"\n*** End Patch';
    expect(patchedPackageJsons(stale, '/repo', read)).toEqual([]);
  });
});

describe('agent wire formats', () => {
  const deny = { permissionDecision: 'deny' as const, permissionDecisionReason: 'not real' };
  const ask = { permissionDecision: 'ask' as const, permissionDecisionReason: 'risky.' };

  it('keeps Claude Code’s shape, and turns Codex’s unsupported ask into a deny with a way through', () => {
    expect(render('claude', 'pre-tool-use', { decision: ask })).toEqual({
      hookSpecificOutput: { hookEventName: 'PreToolUse', ...ask },
    });
    const codex = render('codex', 'pre-tool-use', { decision: ask }) as any;
    expect(codex.hookSpecificOutput.permissionDecision).toBe('deny');
    expect(codex.hookSpecificOutput.permissionDecisionReason).toContain('LURQ_ALLOW=1');
    expect(render('codex', 'prompt', { context: 'tip' })).toEqual({
      hookSpecificOutput: { hookEventName: 'UserPromptSubmit', additionalContext: 'tip' },
    });
  });

  it('speaks Cursor’s field names', () => {
    expect(render('cursor', 'pre-tool-use', { decision: deny })).toEqual({
      permission: 'deny',
      user_message: 'not real',
      agent_message: 'not real',
    });
    expect(render('cursor', 'post-tool-use', { context: 'call usage' })).toEqual({
      additional_context: 'call usage',
    });
    expect(render('cursor', 'session-start', null)).toBeNull();
  });

  it('reads Cursor input as Claude Code input', () => {
    expect(normalize('cursor', { conversation_id: 'c1', command: 'npm i zod', cwd: '/p' })).toEqual(
      {
        session_id: 'c1',
        cwd: '/p',
        tool_name: 'Bash',
        tool_input: { command: 'npm i zod' },
      },
    );
    expect(normalize('cursor', { session_id: 's', workspace_roots: ['/w'] })).toEqual({
      session_id: 's',
      cwd: '/w',
    });
    const claude = { session_id: 's', tool_name: 'Edit' };
    expect(normalize('claude', claude)).toBe(claude);
  });

  it('lets a user-approved command through', () => {
    expect(installTargets('LURQ_ALLOW=1 npm i evil-pkg')).toEqual([]);
  });
});
