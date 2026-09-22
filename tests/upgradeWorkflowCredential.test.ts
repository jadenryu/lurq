/**
 * Two failures this workflow used to turn into a red run that did nothing.
 *
 *  · A repo whose dashboard says `pr` but holds no Anthropic secret failed at
 *    the credential gate — after the analysis had already been posted. Nine
 *    repositories were set up that way in one command and every run failed.
 *    `fix` needs no model, so the run now drops to it and says so.
 *  · lurq's OWN repository cannot run `npx -y lurqrun@0.1`: npm resolves the
 *    spec against the local package of that name, whose bin is unbuilt, and
 *    the step exits 127 with `lurq: not found`.
 */
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { renderWorkflow } from '../src/github/workflow';

interface Step {
  name?: string;
  if?: string;
  run?: string;
}
const steps = (local = false): Step[] =>
  (parse(renderWorkflow({ mode: 'fix', local })) as { jobs: { upgrade: { steps: Step[] } } }).jobs
    .upgrade.steps;

describe('the credential gate', () => {
  const gate = () => steps().find((s) => s.name === 'Check agent credentials')!;

  it('drops to fix instead of failing the run', () => {
    const run = gate().run!;
    expect(run).toContain('LURQ_MODE=fix');
    expect(run).not.toContain('exit 1');
  });

  it('says out loud that the agent was skipped', () => {
    // Degrading silently would let someone believe an agent is migrating their
    // code when nothing is: the warning is what makes the fallback honest.
    expect(gate().run).toContain('::warning::');
    expect(gate().run).toContain('GITHUB_STEP_SUMMARY');
  });

  it('still only applies to pr, since fix and comment need nothing', () => {
    expect(gate().if).toBe("env.LURQ_MODE == 'pr'");
  });
});

describe('running against the CLI this checkout builds', () => {
  it('builds it first and calls the built binary', () => {
    const list = steps(true);
    const build = list.findIndex((s) => s.name === 'Build the CLI from this checkout');
    const plan = list.findIndex((s) => s.name === 'Plan');
    expect(build).toBeGreaterThan(-1);
    expect(build).toBeLessThan(plan);
    expect(list[plan]!.run).toContain('node dist/bin/lurq.js');
    expect(list[plan]!.run).not.toContain('npx');
  });

  it('is off unless asked for: every other repo uses the published, pinned CLI', () => {
    expect(steps().some((s) => s.run?.includes('node dist/bin/lurq.js'))).toBe(false);
    expect(steps().some((s) => s.name === 'Build the CLI from this checkout')).toBe(false);
  });
});

describe('committing into a repository that has its own git hooks', () => {
  it('ignores them for the bot commit, after the install that creates them', () => {
    // A husky/lint-staged pre-commit hook failed the only commit the job
    // exists to make, so the run did all the work and opened nothing.
    const list = steps();
    const hooks = list.findIndex((s) => s.run?.includes('core.hooksPath'));
    const install = list.findIndex((s) => s.name === 'Install dependencies');
    const pr = list.findIndex((s) => s.name === 'Open pull request');
    expect(install).toBeLessThan(hooks);
    expect(hooks).toBeLessThan(pr);
  });

  it('does not touch hooks in a run that commits nothing', () => {
    const gate = steps().find((s) => s.run?.includes('core.hooksPath'))!.if!;
    expect(gate).not.toContain('comment');
  });
});
