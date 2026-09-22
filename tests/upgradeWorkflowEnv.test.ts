/**
 * The environment check in the generated upgrade workflow.
 *
 * This file lands in the user's repository and then runs on a schedule without
 * them, so the properties worth pinning are the ones that would fail quietly:
 * it must appear only when the policy grants it, it must NOT inherit the
 * arming guard (analyse-only is the mode most repos sit in, and a read-only
 * check belongs there), and it must not fail a build nobody asked it to fail.
 */
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { cliSpec, renderWorkflow, npxLurq } from '../src/github/workflow';

interface Step {
  name?: string;
  uses?: string;
  if?: string;
  run?: string;
}

const steps = (opts: Parameters<typeof renderWorkflow>[0] = {}): Step[] =>
  (parse(renderWorkflow(opts)) as { jobs: { upgrade: { steps: Step[] } } }).jobs.upgrade.steps;

const envStep = (list: Step[]) => list.find((s) => s.run?.includes('check-env'));

describe('without the permission', () => {
  it('adds no step at all', () => {
    expect(envStep(steps())).toBeUndefined();
    expect(envStep(steps({ checkEnv: false }))).toBeUndefined();
  });

  it('leaves the workflow otherwise unchanged, so an ungranted repo sees today’s file', () => {
    expect(renderWorkflow()).toBe(renderWorkflow({ checkEnv: false }));
  });
});

describe('with the permission', () => {
  const list = () => steps({ checkEnv: true });

  it('runs check-env against the repo', () => {
    expect(envStep(list())!.run).toContain('check-env .');
  });

  it('is not gated on LURQ_MODE, because it writes nothing', () => {
    // The failure this catches: inheriting the arming guard would stop it
    // running in analyse-only mode, which is where most repos live.
    expect(envStep(list())!.if).toBeUndefined();
  });

  it('does not fail the build', () => {
    // No --exit-code: a repo should not start failing CI the day it connects.
    expect(envStep(list())!.run).not.toContain('--exit-code');
  });

  it('reports into the run summary, where the rest of the report already is', () => {
    expect(envStep(list())!.run).toContain('GITHUB_STEP_SUMMARY');
  });

  it('is pinned like every other CLI invocation in this file', () => {
    expect(envStep(list())!.run).toContain(`${npxLurq()} `);
  });

  it('runs before the arming boundary, not after it', () => {
    const l = list();
    const env = l.findIndex((s) => Boolean(s.run?.includes('check-env')));
    const credentials = l.findIndex((s) => s.name === 'Check agent credentials');
    expect(env).toBeGreaterThanOrEqual(0);
    expect(credentials).toBeGreaterThan(env);
  });

  it('asks for no extra permission to do it', () => {
    // A read-only check must not widen the workflow's trust model.
    const granted = parse(renderWorkflow({ checkEnv: true })) as {
      permissions: Record<string, string>;
    };
    expect(granted.permissions).toEqual({ contents: 'write', 'pull-requests': 'write' });
  });
});
