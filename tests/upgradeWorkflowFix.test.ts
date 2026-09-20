/**
 * The deterministic step in the upgrade workflow.
 *
 * `lurq fix` makes the changes the package itself proves — renamed call sites,
 * and the range bump in every manifest — so the model that follows spends its
 * run on what actually needs judgement. This file pins the properties that make
 * that safe: it never runs in analyse-only mode, it inherits the same
 * blast-radius cap the agent is given, and it runs after the install rather
 * than before it.
 */
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { cliSpec, renderWorkflow } from '../src/github/workflow';

interface Step {
  name?: string;
  uses?: string;
  if?: string;
  run?: string;
}

const steps = (): Step[] =>
  (parse(renderWorkflow()) as { jobs: { upgrade: { steps: Step[] } } }).jobs.upgrade.steps;

const indexOfStep = (list: Step[], match: (s: Step) => boolean) => list.findIndex(match);

const fixStep = (list: Step[]) => list.find((s) => s.run?.includes(' fix '));

describe('the deterministic step', () => {
  it('runs lurq fix against the plan the earlier step wrote', () => {
    const step = fixStep(steps())!;
    expect(step).toBeDefined();
    expect(step.run).toContain('--plan lurq-plan.json');
    expect(step.run).toContain('--apply');
  });

  it('never runs in analyse-only mode', () => {
    // Connecting a repo must not edit it. The guard widened when `fix` mode
    // arrived — this step IS the whole of that mode — so the invariant is no
    // longer one exact string. What has to stay true is that it runs in both
    // writing modes and in neither analyse-only one.
    const gate = fixStep(steps())!.if!;
    expect(gate).toContain("env.LURQ_MODE == 'pr'");
    expect(gate).toContain("env.LURQ_MODE == 'fix'");
    expect(gate).not.toContain('comment');
  });

  it('inherits the same blast-radius cap the agent is given', () => {
    // Without this the deterministic step would bump every package in the plan
    // while the model beside it is capped at MAX_UPGRADES — removing a limit
    // the repository chose.
    expect(fixStep(steps())!.run).toContain('--max ${{ env.MAX_UPGRADES }}');
  });

  it('is pinned like every other CLI invocation in this file', () => {
    expect(fixStep(steps())!.run).toContain(`npx -y ${cliSpec()} `);
  });
});

describe('where it sits', () => {
  it('runs after the install, so the manifest bump cannot desync the lockfile', () => {
    // Bumping package.json before `npm ci` fails the install outright with a
    // lock-out-of-sync error; the agent's own install step reconciles it after.
    const list = steps();
    const install = indexOfStep(list, (s) => s.name === 'Install dependencies');
    const fix = indexOfStep(list, (s) => Boolean(s.run?.includes(' fix ')));
    expect(install).toBeGreaterThanOrEqual(0);
    expect(fix).toBeGreaterThan(install);
  });

  it('runs before the model, which is the entire point', () => {
    const list = steps();
    const fix = indexOfStep(list, (s) => Boolean(s.run?.includes(' fix ')));
    const agent = indexOfStep(list, (s) =>
      Boolean(s.uses?.startsWith('anthropics/claude-code-action')),
    );
    expect(agent).toBeGreaterThan(fix);
  });
});

describe('the prompt the model receives', () => {
  const prompt = () => steps().find((s) => s.uses?.startsWith('anthropics/claude-code-action'))!;

  it('tells the model the mechanical work is already applied', () => {
    // Otherwise it redoes the renames, or reverts them as unexplained changes.
    const text = JSON.stringify(prompt());
    expect(text).toMatch(/already applied/i);
  });

  it('still forbids git, so version control stays the workflow job', () => {
    const text = JSON.stringify(prompt());
    expect(text).not.toMatch(/Bash\(git/);
  });
});
