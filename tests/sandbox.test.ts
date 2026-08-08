import { describe, it, expect } from 'vitest';
import { npmInstallArgs, smokeScript } from '../src/sandbox/local';

describe('npmInstallArgs', () => {
  it('ignores install scripts by default', () => {
    const args = npmInstallArgs(['left-pad@1.3.0'], { allowScripts: false });
    expect(args).toContain('--ignore-scripts');
    expect(args).toContain('left-pad@1.3.0');
  });

  it('installs multiple specs together (for compatibility checks)', () => {
    const args = npmInstallArgs(['react@19', 'react-dom@19'], { allowScripts: false });
    expect(args).toEqual(expect.arrayContaining(['react@19', 'react-dom@19']));
  });

  it('runs install scripts only when explicitly allowed', () => {
    expect(npmInstallArgs(['x'], { allowScripts: true })).not.toContain('--ignore-scripts');
  });

  it('suppresses audit/fund/lockfile noise', () => {
    expect(npmInstallArgs(['x'], { allowScripts: false })).toEqual(
      expect.arrayContaining(['--no-audit', '--no-fund', '--no-package-lock', '--no-save']),
    );
  });
});

describe('smokeScript', () => {
  // One path for both module systems: import() loads ESM and CJS alike, and the
  // branch it replaced was choosing require() for everything, because nothing
  // ever derived the module system (DEFAULT_TARGET hardcodes 'cjs'). ESM-only
  // packages were therefore recorded as failing to load — measured on
  // nanoid@6.0.1, which installs and works.
  it('always loads via dynamic import, under module input', () => {
    const s = smokeScript('react');
    expect(s).toContain('--input-type=module');
    expect(s.join(' ')).toContain('await import("react")');
  });

  it('loads an ESM-only package the same way as a CJS one', () => {
    expect(smokeScript('nanoid').join(' ')).toContain('await import("nanoid")');
    expect(smokeScript('nanoid').join(' ')).not.toContain('require(');
  });

  it('JSON-quotes the package name (no shell injection surface)', () => {
    // execFile (no shell) + JSON.stringify means a hostile name can't break out.
    expect(smokeScript('a"); evil()//').join(' ')).toContain('"a\\"); evil()//"');
  });
});
