import { describe, expect, it } from 'vitest';
import { cliSpec, npxLurq, renderWorkflow } from '../src/github/workflow';
import { BIN_NAME, PACKAGE_NAME } from '../src/core/constants';

/**
 * The generated workflow runs in the USER's Actions, so a mistake here is one
 * lurq cannot see and cannot fix for them. `npx -y lurqrun@0.1 upgrade-plan`
 * shipped for real and failed on GitHub's runners with exit 127, killing every
 * armed repository at its first step. It relies on npx falling back to a
 * package's only bin when no bin matches the package name; naming both removes
 * the dependency on that fallback.
 */
describe('generated workflow invocation', () => {
  it('names the package to install and the binary to run separately', () => {
    expect(npxLurq('0.1.9')).toBe(`npx -y --package ${PACKAGE_NAME}@0.1 ${BIN_NAME}`);
  });

  it('never invokes the package name as if it were the command', () => {
    // The exact shape that failed in CI. If it reappears anywhere in the
    // workflow, every armed repo is back to depending on npx's bin fallback.
    const workflow = renderWorkflow({ mode: 'pr', checkEnv: true, autoMerge: true });
    expect(workflow).not.toContain(`npx -y ${PACKAGE_NAME}@`);
    expect(workflow).not.toMatch(new RegExp(`npx [^\\n]*${PACKAGE_NAME}@[\\d.]+ (?!${BIN_NAME})`));
  });

  it('runs every lurq step through the one helper', () => {
    const workflow = renderWorkflow({ mode: 'pr', checkEnv: true });
    const invocations = workflow.match(/npx [^\n]*/g) ?? [];
    expect(invocations.length).toBeGreaterThan(0);
    for (const line of invocations) {
      expect(line, line).toContain(`--package ${cliSpec()} ${BIN_NAME}`);
    }
  });

  it('still pins the version range, so a bad publish is not an incident in every repo', () => {
    expect(npxLurq('0.1.9')).toContain('@0.1');
    expect(npxLurq('0.1.9')).not.toContain('0.1.9');
    expect(npxLurq('2.3.4')).toContain(`${PACKAGE_NAME}@2`);
  });

  it('keeps the binary distinct from the package name', () => {
    // If these ever converge, the bug above stops being possible — but until
    // then, conflating them is what broke it.
    expect(BIN_NAME).not.toBe(PACKAGE_NAME);
  });
});
