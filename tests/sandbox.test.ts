import { describe, it, expect } from 'vitest';
import { npmInstallArgs, smokeScript } from '../src/sandbox/local';

describe('npmInstallArgs', () => {
  it('ignores install scripts by default', () => {
    const args = npmInstallArgs('left-pad@1.3.0', { allowScripts: false });
    expect(args).toContain('--ignore-scripts');
    expect(args).toContain('left-pad@1.3.0');
  });

  it('runs install scripts only when explicitly allowed', () => {
    expect(npmInstallArgs('x', { allowScripts: true })).not.toContain('--ignore-scripts');
  });

  it('suppresses audit/fund/lockfile noise', () => {
    expect(npmInstallArgs('x', { allowScripts: false })).toEqual(
      expect.arrayContaining(['--no-audit', '--no-fund', '--no-package-lock', '--no-save']),
    );
  });
});

describe('smokeScript', () => {
  it('uses require for cjs', () => {
    expect(smokeScript('react', 'cjs').join(' ')).toContain('require("react")');
  });

  it('uses dynamic import (module input) for esm', () => {
    const s = smokeScript('react', 'esm');
    expect(s).toContain('--input-type=module');
    expect(s.join(' ')).toContain('import("react")');
  });

  it('JSON-quotes the package name (no shell injection surface)', () => {
    // execFile (no shell) + JSON.stringify means a hostile name can't break out.
    expect(smokeScript('a"); evil()//', 'cjs').join(' ')).toContain('"a\\"); evil()//"');
  });
});
