/**
 * Where the job gets its mode from.
 *
 * The autopilot toggle on the dashboard used to be a no-op for any workflow
 * already committed: it writes a database row, and lurq's GitHub App is
 * Contents:read-only — it cannot rewrite that file, and cannot set a repository
 * variable either. So the mode is READ at runtime, out of the plan response the
 * job already fetches on every run.
 *
 * What this file pins is the precedence, because getting it wrong in either
 * direction is bad in a way no error would show: too eager and a server
 * response overrides a choice someone committed by hand, too timid and the
 * toggle goes on doing nothing.
 */
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { renderWorkflow, type WorkflowOptions } from '../src/github/workflow';

interface Step {
  name?: string;
  uses?: string;
  if?: string;
  run?: string;
}

const job = (opts: WorkflowOptions = {}) =>
  (parse(renderWorkflow(opts)) as {
    jobs: { upgrade: { steps: Step[]; env: Record<string, string> } };
  }).jobs.upgrade;

const steps = (opts: WorkflowOptions = {}) => job(opts).steps;
const resolveStep = (opts: WorkflowOptions = {}) =>
  steps(opts).find((s) => s.name === 'Resolve mode');

describe('the job-level mode', () => {
  it('starts empty, leaving room for the dashboard setting', () => {
    // If this baked a mode in, the resolve step below could never run: it is
    // guarded on the variable being unset, which is what keeps an explicit
    // choice from being overridden.
    expect(job().env.LURQ_MODE).toBe("${{ inputs.mode || vars.LURQ_MODE || '' }}");
  });

  it('still lets a repository variable and a dispatch input win', () => {
    // Precedence is explicit-first, and both explicit sources sit ahead of the
    // empty fallback in the same expression.
    const value = job().env.LURQ_MODE;
    expect(value.indexOf('inputs.mode')).toBeLessThan(value.indexOf('vars.LURQ_MODE'));
    expect(resolveStep()!.if).toBe("env.LURQ_MODE == ''");
  });
});

describe('the resolve step', () => {
  it('reads the mode out of the plan the previous step wrote', () => {
    const step = resolveStep()!;
    expect(step).toBeDefined();
    expect(step.run).toContain('lurq-plan.json');
    expect(step.run).toContain('.mode');
    expect(step.run).toContain('GITHUB_ENV');
  });

  it('runs after the plan and before anything gated on the mode', () => {
    // A resolve step that landed after the first gated step would decide the
    // mode too late to govern it, and every `if:` would read the empty value.
    const list = steps();
    const plan = list.findIndex((s) => s.name === 'Plan');
    const resolve = list.findIndex((s) => s.name === 'Resolve mode');
    const firstGated = list.findIndex((s) => s.if === "env.LURQ_MODE == 'pr'");
    expect(plan).toBeGreaterThanOrEqual(0);
    expect(resolve).toBeGreaterThan(plan);
    expect(firstGated).toBeGreaterThan(resolve);
  });

  it('accepts only the two values a mode may be', () => {
    // The value arrives over the network and is written into GITHUB_ENV, where
    // it then decides whether the editing half of this job runs. Anything but
    // these two falls back to the generated default rather than through.
    const run = resolveStep()!.run!;
    expect(run).toContain('case "$MODE" in');
    expect(run).toContain('pr|comment)');
    expect(run).toContain("*) MODE='comment' ;;");
  });

  it('falls back to the mode the file was generated with, not to comment', () => {
    // A repo that installed while armed must stay armed when the server has no
    // opinion about it — an unconnected repo, or an older API that sends no
    // mode at all. Reading absence as `comment` would disarm it silently.
    expect(resolveStep({ armed: true })!.run).toContain("*) MODE='pr' ;;");
  });
});
