import { describe, it, expect } from 'vitest';
import { shQuote, installCommand, smokeCommand } from '../src/sandbox/e2b';

describe('e2b command builders', () => {
  it('single-quotes args, neutralizing shell metacharacters', () => {
    // Version ranges and injection attempts must not break out of the arg.
    expect(shQuote('left-pad@^1.0.0')).toBe(`'left-pad@^1.0.0'`);
    expect(shQuote('a; rm -rf /')).toBe(`'a; rm -rf /'`);
    expect(shQuote(`a'b`)).toBe(`'a'\\''b'`);
  });

  it('builds an install command with quoted specs and expected flags', () => {
    const cmd = installCommand(['react@19', 'react-dom@19'], false);
    expect(cmd).toContain(`'react@19'`);
    expect(cmd).toContain(`'react-dom@19'`);
    expect(cmd).toContain('--ignore-scripts');
    expect(cmd.startsWith('npm install ')).toBe(true);
  });

  it('omits --ignore-scripts when scripts are allowed', () => {
    expect(installCommand(['x'], true)).not.toContain('--ignore-scripts');
  });

  it('rejects a spec that would be parsed as an npm flag', () => {
    expect(() => installCommand(['--registry=evil'], false)).toThrow(/Invalid package spec/);
  });

  it('a malicious version range stays inside a single quoted arg', () => {
    const cmd = installCommand(['pkg@$(curl evil)'], false);
    expect(cmd).toContain(`'pkg@$(curl evil)'`); // literal, not a subshell
  });

  it('smoke command always loads via import, pkg name JSON-quoted', () => {
    const cmd = smokeCommand('react');
    expect(cmd).toContain('--input-type=module');
    expect(cmd).toContain('await import("react")');
    expect(cmd).not.toContain('require(');
  });
});
