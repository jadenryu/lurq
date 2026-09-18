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
import { modeDisagreement } from '../src/cli/checkUpgrade';
import { cronForScope, renderWorkflow, type WorkflowOptions } from '../src/github/workflow';

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
    // `?? ''` because reading a Record by key is indexed access, so the type
    // is string | undefined. The assertion above is what pins the value's
    // presence; this one only cares about the order inside it.
    const value = job().env.LURQ_MODE ?? '';
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

  it('accepts only the three values a mode may be', () => {
    // The value arrives over the network and is written into GITHUB_ENV, where
    // it then decides whether the editing half of this job runs. Anything but
    // these three falls back to the generated default rather than through.
    const run = resolveStep()!.run!;
    expect(run).toContain('case "$MODE" in');
    expect(run).toContain('pr|fix|comment)');
    expect(run).toContain("*) MODE='comment' ;;");
  });

  it('falls back to the mode the file was generated with, not to comment', () => {
    // A repo that installed while armed must stay armed when the server has no
    // opinion about it — an unconnected repo, or an older API that sends no
    // mode at all. Reading absence as `comment` would disarm it silently.
    expect(resolveStep({ armed: true })!.run).toContain("*) MODE='pr' ;;");
  });
});

/**
 * `fix` mode: the deterministic half, on its own.
 *
 * `pr` cannot be a default because it needs an Anthropic credential and fails
 * outright without one. `fix` opens the same pull request using only what the
 * package itself proves, so it needs no key — which is what makes it the
 * default an armed repo can actually be given.
 */
describe('fix mode: a pull request with no model', () => {
  const gateOf = (name: string, opts: WorkflowOptions = {}) =>
    steps(opts).find((s) => s.name === name)?.if ?? '';

  it('runs the install, the deterministic edit and the pull request', () => {
    // These three are the whole of `fix`: install so the bump cannot desync the
    // lockfile, apply what the package proves, open the PR.
    for (const name of ['Install dependencies', 'Apply what needs no judgement', 'Open pull request']) {
      expect(gateOf(name), name).toContain("env.LURQ_MODE == 'fix'");
    }
  });

  it('does not run the agent, nor demand its credentials', () => {
    // The entire reason this mode exists. `pr` fails outright on a repo with no
    // Anthropic key, so if either of these widened to `fix` the credential-free
    // mode would be credential-free in name only.
    for (const name of ['Check agent credentials', 'Apply upgrades']) {
      expect(gateOf(name), name).toBe("env.LURQ_MODE == 'pr'");
    }
  });

  it('bakes the chosen mode into both the dispatch default and the fallback', () => {
    const yaml = renderWorkflow({ mode: 'fix' });
    expect(yaml).toContain('default: fix');
    expect(yaml).toContain("*) MODE='fix' ;;");
    // All three offered, or a dispatch cannot select the one it renders.
    expect(yaml).toContain('options: [comment, fix, pr]');
  });

  it('lets auto-merge apply to a deterministic pull request', () => {
    // A provable diff plus the repo's own required checks is the safest case
    // auto-merge has; excluding it would leave the safest mode the only one
    // that cannot land unattended.
    const gate = gateOf('Enable auto-merge', { autoMerge: true, mode: 'fix' });
    expect(gate).toContain("env.LURQ_MODE == 'fix'");
    expect(gate).toContain('steps.pr.outputs.pull-request-number');
  });
});

describe('cronForScope', () => {
  it('runs daily for a repo that asked for advisories only', () => {
    // A weekly cron means up to seven days sitting on a known CVE, which is not
    // defensible for the scope that exists to say this is the urgent part.
    expect(cronForScope('security')).toBe('0 6 * * *');
  });

  it('stays weekly for the scopes that track breakage', () => {
    // Majors arrive slowly enough that a daily run mostly spends the user's
    // Actions minutes reporting nothing new.
    expect(cronForScope('blocking')).toBe('0 6 * * 1');
    expect(cronForScope('all')).toBe('0 6 * * 1');
  });
});

/**
 * The other half, for workflows that predate the resolve step above.
 *
 * Those files have the mode baked in and nothing lurq owns can change them —
 * the GitHub App is Contents:read-only. What CAN reach them is the CLI they
 * invoke with `npx -y`, which resolves the current version on every run. So the
 * disagreement gets reported into the summary they already read.
 */
describe('modeDisagreement', () => {
  it('says so when the dashboard opens pull requests and the workflow does not', () => {
    const note = modeDisagreement('pr', 'comment');
    expect(note).toMatch(/set to 'pr'/);
    expect(note).toMatch(/pinned to 'comment'/);
    expect(note).toMatch(/will not open pull requests/);
    // Naming the file is the whole remedy: re-copying it is the only way this
    // install can start honouring the toggle.
    expect(note).toContain('.github/workflows/lurq-upgrade.yml');
  });

  it('says so in the other direction too', () => {
    // The more surprising one: turning autopilot off on the dashboard does not
    // stop a workflow pinned to pr mode, and someone who believes it did has a
    // job still opening pull requests.
    const note = modeDisagreement('comment', 'pr');
    expect(note).toMatch(/set to 'comment'/);
    expect(note).toMatch(/will still open pull requests/);
  });

  it('names the agent when the file runs it and the dashboard did not ask', () => {
    // The disagreement that actually costs something: `fix` is a deliberate
    // choice to keep a model out of the repo, and a file pinned to `pr` runs
    // one anyway. "fix != pr" would not tell anyone that.
    const note = modeDisagreement('fix', 'pr');
    expect(note).toMatch(/will run the agent/);
    expect(note).toMatch(/does not ask for/);
  });

  it('says when the agent is being skipped rather than run', () => {
    const note = modeDisagreement('pr', 'fix');
    expect(note).toMatch(/only the changes lurq can prove/);
    expect(note).toMatch(/will not run the agent/);
  });

  it('stays quiet when the two agree', () => {
    expect(modeDisagreement('pr', 'pr')).toBeNull();
    expect(modeDisagreement('comment', 'comment')).toBeNull();
  });

  it('stays quiet when the server had no opinion', () => {
    // An unconnected repo or an older API sends no mode. There is no
    // disagreement to report, and inventing one would tell every ungoverned
    // checkout its workflow is misconfigured.
    expect(modeDisagreement(null, 'pr')).toBeNull();
    expect(modeDisagreement(null, 'comment')).toBeNull();
  });

  it('stays quiet when what the run is doing is unreadable', () => {
    // Outside Actions there is no LURQ_MODE at all, and a junk value says
    // nothing about what the job did. Neither is evidence of a mismatch.
    expect(modeDisagreement('pr', undefined)).toBeNull();
    expect(modeDisagreement('pr', '')).toBeNull();
    expect(modeDisagreement('pr', 'PR')).toBeNull();
  });
});
