/**
 * Bumping the declared range, which is the half of an upgrade that turns a
 * rewritten import into a tree that actually builds.
 *
 * The assertions are about the resulting manifest text, applied through the
 * same applyEdits the writer uses, because an offset that is right in a test
 * helper and wrong against the file is the only failure that matters here.
 */
import { describe, expect, it } from 'vitest';
import { declaredRange, decideRange, manifestFindings } from '../src/fix/manifest';
import { applyEdits } from '../src/fix/types';
import type { UpgradeTarget } from '../src/surface/upgrade';

const MANIFEST = `{
  "name": "app",
  "dependencies": {
    "cookie": "^1.1.1",
    "zod": "3.23.8"
  },
  "devDependencies": {
    "vitest": "~2.1.9"
  }
}
`;

const target = (over: Partial<UpgradeTarget> = {}): UpgradeTarget => ({
  package: 'cookie',
  fromVersion: '1.1.1',
  toVersion: '2.0.1',
  ...over,
});

const plan = (targets: UpgradeTarget[], text = MANIFEST) =>
  manifestFindings('/repo', targets, { files: ['package.json'], read: () => text });

const applied = (targets: UpgradeTarget[], text = MANIFEST) => {
  const { findings } = plan(targets, text);
  return applyEdits(text, findings[0]!.fix!.edits!);
};

describe('declaredRange', () => {
  it('finds a range in dependencies, with offsets inside the quotes', () => {
    const found = declaredRange(MANIFEST, 'cookie')!;
    expect(found).toMatchObject({ block: 'dependencies', range: '^1.1.1' });
    expect(MANIFEST.slice(found.start, found.end)).toBe('^1.1.1');
  });

  it('finds one in devDependencies too', () => {
    expect(declaredRange(MANIFEST, 'vitest')).toMatchObject({ block: 'devDependencies', range: '~2.1.9' });
  });

  it('is null for a package the manifest does not declare', () => {
    expect(declaredRange(MANIFEST, 'express')).toBeNull();
  });

  it('survives a manifest that is not an object, rather than throwing', () => {
    expect(declaredRange('[]', 'cookie')).toBeNull();
    expect(declaredRange('', 'cookie')).toBeNull();
  });

  it('reads a manifest with comments and a trailing comma, which JSON.parse refuses', () => {
    const jsonc = `{
  // pinned until the codemod lands
  "dependencies": {
    "cookie": "^1.1.1",
  }
}`;
    expect(() => JSON.parse(jsonc)).toThrow();
    expect(declaredRange(jsonc, 'cookie')).toMatchObject({ range: '^1.1.1' });
  });
});

describe('decideRange', () => {
  const at = (range: string) => ({ block: 'dependencies', range, start: 0, end: range.length });

  it('leaves a range alone when the target already satisfies it', () => {
    expect(decideRange('package.json', at('^2.0.0'), '2.0.1')).toEqual({ satisfied: true });
  });

  it('keeps the operator when it rewrites', () => {
    expect(decideRange('package.json', at('^1.1.1'), '2.0.1').edit).toMatchObject({ text: '^2.0.1' });
    expect(decideRange('package.json', at('~1.1.1'), '2.0.1').edit).toMatchObject({ text: '~2.0.1' });
    expect(decideRange('package.json', at('1.1.1'), '2.0.1').edit).toMatchObject({ text: '2.0.1' });
  });

  it('records what it replaced, so a changed file refuses instead of writing', () => {
    expect(decideRange('package.json', at('^1.1.1'), '2.0.1').edit).toMatchObject({ was: '^1.1.1' });
  });

  it('refuses a range that excludes the target and is not plain', () => {
    for (const range of ['>=1.0.0 <2', '1.x', '1.2.x', 'latest', 'workspace:*']) {
      const decision = decideRange('package.json', at(range), '2.0.1');
      expect(decision.edit, range).toBeUndefined();
      expect(decision.refusedBecause, range).toBeTruthy();
    }
  });

  it('leaves a complex range alone when it already admits the target', () => {
    // Satisfaction is checked before shape, and that order is the point: a
    // range this could never rewrite may still need no rewriting.
    for (const range of ['*', '1 || 2', '>=1.0.0', '>=2.0.0 <3']) {
      expect(decideRange('package.json', at(range), '2.0.1'), range).toEqual({ satisfied: true });
    }
  });

  it('refuses a target that is not an exact version', () => {
    expect(decideRange('package.json', at('^1.1.1'), '^2').refusedBecause).toMatch(/not an exact version/);
  });
});

describe('manifestFindings', () => {
  it('writes the new range into the file and touches nothing else', () => {
    const out = applied([target()]);
    expect(out).toContain('"cookie": "^2.0.1"');
    expect(out).toContain('"zod": "3.23.8"');
    expect(out).toContain('"vitest": "~2.1.9"');
    // The whole file, byte for byte, apart from the six characters of range.
    expect(out).toBe(MANIFEST.replace('"cookie": "^1.1.1"', '"cookie": "^2.0.1"'));
  });

  it('is blocking, because the next install would undo the upgrade', () => {
    const [f] = plan([target()]).findings;
    expect(f!.severity).toBe('blocking');
    expect(f!.code).toBe('outdated-range:cookie');
    expect(f!.fix!.verify).toEqual(['typecheck']);
  });

  it('says nothing when every manifest already admits the target', () => {
    expect(plan([target({ toVersion: '1.1.5' })]).findings).toEqual([]);
  });

  it('reports a refusal instead of guessing at a complex range', () => {
    const text = MANIFEST.replace('"^1.1.1"', '">=1.0.0 <2"');
    const { findings, refused } = plan([target()], text);
    expect(findings).toEqual([]);
    expect(refused[0]).toMatchObject({ package: 'cookie', file: 'package.json' });
  });

  it('bumps every workspace that declares it, in one finding', () => {
    const { findings } = manifestFindings('/repo', [target()], {
      files: ['package.json', 'packages/api/package.json'],
      read: () => MANIFEST,
    });
    expect(findings).toHaveLength(1);
    expect(findings[0]!.fix!.edits!.map((e) => e.file).sort()).toEqual([
      'package.json',
      'packages/api/package.json',
    ]);
  });

  it('skips a manifest it cannot read rather than failing the run', () => {
    const { findings } = manifestFindings('/repo', [target()], {
      files: ['package.json', 'gone/package.json'],
      read: (f) => (f === 'package.json' ? MANIFEST : null),
    });
    expect(findings[0]!.fix!.edits!.map((e) => e.file)).toEqual(['package.json']);
  });
});
