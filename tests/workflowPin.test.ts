import { describe, expect, it } from 'vitest';
import { cliSpec, renderWorkflow } from '../src/github/workflow';
import { PACKAGE_NAME, VERSION } from '../src/core/constants';

/**
 * The generated workflow lives in the *user's* repository, so a bad publish
 * cannot be fixed for them after the fact — it just runs. These tests pin the
 * one property that keeps that from being an incident: the CLI is never
 * requested by a bare name.
 */
describe('cliSpec', () => {
  it('holds the minor line while pre-1.0, where a minor bump may break', () => {
    // semver §4: while 0.x, anything may change at any time. `lurqrun@0` would
    // happily jump 0.0.x → 0.1.0 and take a breaking CLI with it.
    expect(cliSpec('0.0.8')).toBe('lurqrun@0.0');
    expect(cliSpec('0.3.1')).toBe('lurqrun@0.3');
  });

  it('holds the major from 1.0, matching the action pins above it', () => {
    expect(cliSpec('1.4.2')).toBe('lurqrun@1');
    expect(cliSpec('2.0.0')).toBe('lurqrun@2');
  });

  it('tracks the shipped version rather than a hardcoded copy', () => {
    expect(cliSpec()).toBe(cliSpec(VERSION));
    expect(cliSpec()).toContain(PACKAGE_NAME);
  });
});

describe('renderWorkflow', () => {
  const yaml = renderWorkflow();

  it('never invokes the CLI unpinned', () => {
    // The actual defect being guarded: `npx -y lurqrun <cmd>` resolves to
    // whatever is newest at run time, in a file that pins everything else.
    expect(yaml).not.toMatch(new RegExp(`npx -y ${PACKAGE_NAME}\\s`));
    expect(yaml).toContain(`npx -y ${cliSpec()} `);
  });

  it('pins every npx invocation, not just the first', () => {
    const invocations = yaml.match(/npx -y \S+/g) ?? [];
    expect(invocations.length).toBeGreaterThan(0);
    for (const call of invocations) {
      expect(call).toBe(`npx -y ${cliSpec()}`);
    }
  });

  it('still pins the actions it depends on', () => {
    expect(yaml).toMatch(/uses: actions\/checkout@v\d/);
    expect(yaml).toMatch(/uses: actions\/setup-node@v\d/);
  });
});
