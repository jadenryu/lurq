/**
 * The Claude Code install hook: which commands it reads, what it decides, and
 * that setup merges it into the user's settings without disturbing their hooks.
 */
import { describe, expect, it } from 'vitest';
import { addedDependencies, decide, installTargets, runTargets, specName } from '../src/cli/hook';
import { hasClaudeHook, withClaudeHook, withoutClaudeHook } from '../src/cli/installSkill';
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
    expect(installTargets('npm install zod@^3 -D @tanstack/react-query@5')).toEqual(['zod', '@tanstack/react-query']);
    expect(installTargets('cd apps/web && pnpm add --filter web lodahs')).toEqual(['lodahs']);
    expect(installTargets('CI=1 yarn add left-pad; bun i hono')).toEqual(['left-pad', 'hono']);
  });

  it('ignores installs with no names, paths, git, tarballs, aliases and non-install commands', () => {
    expect(installTargets('npm install')).toEqual([]);
    expect(installTargets('npm i ./local ../x file:../y github:a/b a/b https://x.io/p.tgz pkg.tgz foo@npm:bar')).toEqual([]);
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
    expect(decide([{ name: 'evil', verdict: verdict('high', ['install script\nreads ~/.ssh']) }])).toEqual({
      permissionDecision: 'ask',
      permissionDecisionReason: 'lurq flags evil as high risk: evil: install script reads ~/.ssh. Run `lurq verify <package>` for the evidence.',
    });
    expect(decide([{ name: 'zod', verdict: verdict('medium', ['deprecated']) }, { name: 'hono', verdict: verdict('low') }])).toBeNull();
    expect(decide([])).toBeNull();
  });
});

describe('Claude Code settings', () => {
  const user = { model: 'opus', hooks: { PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: 'my-guard' }] }], Stop: [] } };

  it('adds one hook next to the user’s, idempotently, and removes it back to the original', () => {
    const once = withClaudeHook(user, 'lurq');
    const twice = withClaudeHook(once, 'lurq');
    expect(twice).toEqual(once);
    expect(hasClaudeHook(once)).toBe(true);
    expect(once.hooks.PreToolUse).toHaveLength(2);
    expect(once.hooks.PreToolUse[1].hooks[0].command).toBe('lurq hook pre-tool-use');
    expect(withoutClaudeHook(once)).toEqual(user);
  });

  it('leaves no empty hooks object behind when ours was the only one', () => {
    expect(withoutClaudeHook(withClaudeHook({}, 'lurq'))).toEqual({});
    expect(withoutClaudeHook(user)).toBe(user);
  });
});

describe('runTargets', () => {
  it('reads the package a runner fetches, not its arguments', () => {
    expect(runTargets('npx -y create-next-app@latest my-app --ts')).toEqual(['create-next-app']);
    expect(runTargets('pnpm dlx shadcn@latest add button && bunx cowsay hi')).toEqual(['shadcn', 'cowsay']);
    expect(runTargets('npx -p @scope/tool --package=other run-it')).toEqual(['@scope/tool', 'other', 'run-it']);
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
    expect(addedDependencies(pkg({ zod: '^3' }), pkg({ zod: '^4', hono: '^4' }, { lodahs: '1.0.0' }))).toEqual(['hono', 'lodahs']);
    expect(addedDependencies('', pkg({ zod: '^3' }))).toEqual(['zod']);
  });

  it('ignores workspace, file, git and alias ranges, and unparseable files', () => {
    expect(addedDependencies(pkg({}), pkg({ a: 'workspace:*', b: 'file:../b', c: 'github:x/c', d: 'npm:zod@3' }))).toEqual([]);
    expect(addedDependencies(pkg({}), '{ "dependencies": { oops')).toBeNull();
  });
});

describe('decide for runners', () => {
  it('never denies a missing name, still asks on high risk', () => {
    expect(decide([{ name: 'nope', verdict: verdict('invalid', ['no such package']) }], { deny: false })).toBeNull();
    expect(decide([{ name: 'evil', verdict: verdict('high', ['bad']) }], { deny: false })?.permissionDecision).toBe('ask');
  });
});
