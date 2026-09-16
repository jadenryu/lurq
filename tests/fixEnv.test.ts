/**
 * Undeclared environment variables.
 *
 * The property that decides whether this is usable is the ambient allowlist: a
 * check that reports NODE_ENV and GITHUB_SHA as missing is noise, and noise
 * gets switched off. The property that decides whether it is SAFE is that no
 * value from a .env file can reach a finding.
 */
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { declaredNames, envFindings, envReadsIn } from '../src/fix/env';

describe('envReadsIn', () => {
  it('finds both spellings of a read, with line numbers', () => {
    const reads = envReadsIn('src/a.ts', `const a = process.env.STRIPE_KEY;\nconst b = process.env['SENTRY_DSN'];\n`);
    expect(reads).toEqual([
      { name: 'STRIPE_KEY', file: 'src/a.ts', line: 1 },
      { name: 'SENTRY_DSN', file: 'src/a.ts', line: 2 },
    ]);
  });

  it('ignores a name that only appears in a comment or a string', () => {
    // A regex-based detector reports both of these, and is wrong twice.
    const reads = envReadsIn(
      'src/a.ts',
      `// set process.env.FAKE_ONE before running\nconst doc = 'process.env.FAKE_TWO';\n`,
    );
    expect(reads).toEqual([]);
  });

  it('ignores a dynamic access, rather than inventing the name', () => {
    expect(envReadsIn('src/a.ts', `const v = process.env[key];\n`)).toEqual([]);
  });

  it('is not fooled by something else called env', () => {
    expect(envReadsIn('src/a.ts', `const v = config.env.TOKEN;\nconst w = proc.env.TOKEN;\n`)).toEqual([]);
  });

  it('reads every occurrence, so the evidence can cite them all', () => {
    const reads = envReadsIn('src/a.ts', `process.env.A;\nprocess.env.A;\n`);
    expect(reads.map((r) => r.line)).toEqual([1, 2]);
  });
});

describe('declaredNames', () => {
  let root: string;
  const write = (name: string, body: string) => writeFileSync(join(root, name), body, 'utf8');

  it('takes the name left of the first = and never the value', () => {
    root = mkdtempSync(join(tmpdir(), 'lurq-env-'));
    try {
      write('.env.example', 'STRIPE_KEY=\nSENTRY_DSN=https://user:pass@example.com/1\n');
      const names = declaredNames(root);
      expect([...names].sort()).toEqual(['SENTRY_DSN', 'STRIPE_KEY']);
      // The whole point: a URL with credentials in it is not carried anywhere.
      expect(JSON.stringify([...names])).not.toContain('example.com');
      expect(JSON.stringify([...names])).not.toContain('pass');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('counts a commented declaration, which is how optional vars are documented', () => {
    root = mkdtempSync(join(tmpdir(), 'lurq-env-'));
    try {
      write('.env.example', '# Optional. Defaults to memory.\n# REDIS_URL=redis://localhost:6379\n');
      expect([...declaredNames(root)]).toEqual(['REDIS_URL']);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('does not let prose become a declaration', () => {
    root = mkdtempSync(join(tmpdir(), 'lurq-env-'));
    try {
      // No `=`, so none of these name a variable — which is why bare lines,
      // once a leading # is stripped, can no longer count as declarations.
      write('.env.example', '# Database settings\n# Set this before running\nBARE\n');
      expect([...declaredNames(root)]).toEqual([]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('strips a shell-style export prefix', () => {
    root = mkdtempSync(join(tmpdir(), 'lurq-env-'));
    try {
      write('.env', 'export DATABASE_URL=postgres://localhost/x\n');
      expect([...declaredNames(root)]).toEqual(['DATABASE_URL']);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('is empty when the project declares nothing, without throwing', () => {
    root = mkdtempSync(join(tmpdir(), 'lurq-env-'));
    try {
      expect(declaredNames(root).size).toBe(0);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe('envFindings', () => {
  const plan = (source: string, declared: string[] = []) =>
    envFindings('/repo', {
      files: ['/repo/src/a.ts'],
      read: () => source,
      declared: new Set(declared),
    });

  it('reports a variable the code reads and nothing declares', () => {
    const { findings } = plan(`const k = process.env.STRIPE_KEY;\n`);
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      domain: 'env',
      code: 'env-undeclared:STRIPE_KEY',
      severity: 'warning',
      file: 'src/a.ts',
    });
    expect(findings[0]!.evidence).toBe('read at src/a.ts:1');
  });

  it('says nothing about a variable that is declared', () => {
    expect(plan(`process.env.STRIPE_KEY;\n`, ['STRIPE_KEY']).findings).toEqual([]);
  });

  it('stays quiet about anything the platform supplies', () => {
    const source = [
      'process.env.NODE_ENV',
      'process.env.CI',
      'process.env.PORT',
      'process.env.HOME',
      'process.env.GITHUB_SHA',
      'process.env.RUNNER_OS',
      'process.env.npm_package_version',
      'process.env.VERCEL_URL',
      'process.env.RAILWAY_ENVIRONMENT',
      'process.env.AWS_REGION',
    ].join(';\n');
    expect(plan(source).findings).toEqual([]);
  });

  it('sends the agent to the user for a value, and forbids inventing one', () => {
    const task = plan(`process.env.STRIPE_KEY;\n`).findings[0]!.fix!.task!;
    expect(task.instruction).toMatch(/Add it to \.env\.example/);
    expect(task.instruction).toMatch(/never from a log, an example file, a previous run, or a guess/);
    expect(task.files).toEqual(['src/a.ts']);
  });

  it('groups every read of one variable into a single finding', () => {
    const { findings } = plan(`process.env.A;\nprocess.env.A;\nprocess.env.A;\n`);
    expect(findings).toHaveLength(1);
    expect(findings[0]!.evidence).toBe('read at src/a.ts:1, src/a.ts:2, src/a.ts:3');
  });

  it('caps the cited sites but still counts them', () => {
    const { findings } = plan(Array.from({ length: 8 }, () => 'process.env.A;').join('\n'));
    expect(findings[0]!.evidence).toMatch(/and 3 more$/);
    expect(findings[0]!.fix!.task!.evidence[0]).toBe('8 read(s)');
  });

  it('reports every read for a denominator, declared or not', () => {
    const { reads } = plan(`process.env.NODE_ENV;\nprocess.env.STRIPE_KEY;\n`);
    expect(reads.map((r) => r.name)).toEqual(['NODE_ENV', 'STRIPE_KEY']);
  });

  it('orders findings by name, so a report does not reshuffle between runs', () => {
    const { findings } = plan(`process.env.ZED;\nprocess.env.ALPHA;\n`);
    expect(findings.map((f) => f.code)).toEqual(['env-undeclared:ALPHA', 'env-undeclared:ZED']);
  });

  it('skips a file it cannot read rather than failing the scan', () => {
    const { findings, reads } = envFindings('/repo', {
      files: ['/repo/src/a.ts'],
      read: () => null,
      declared: new Set(),
    });
    expect(findings).toEqual([]);
    expect(reads).toEqual([]);
  });
});

/**
 * The precision rules, each of which exists because a scan of a real repo
 * produced a finding that was wrong. They are tested because they manifest as
 * an ABSENT finding, which is the kind of behaviour that regresses in silence.
 */
describe('precision', () => {
  const at = (file: string, source: string) =>
    envFindings('/repo', { files: [`/repo/${file}`], read: () => source, declared: new Set() });

  it('ignores a read in a test, fixture or spec file', () => {
    // Measured: FIXTURE_ECHO and LURQ_TEST_DATABASE_URL were reported as
    // undeclared. Both are set by the harness that runs the code reading them.
    for (const file of [
      'tests/a.test.ts',
      'tests/fixtures/server.mjs',
      'src/thing.spec.ts',
      '__tests__/a.ts',
      'apps/web/e2e/flow.spec.ts',
    ]) {
      expect(at(file, `process.env.SECRET_THING;\n`).findings, file).toEqual([]);
    }
  });

  it('still scans ordinary source that merely mentions test in a longer word', () => {
    expect(at('src/testing-utils.ts', `process.env.SECRET_THING;\n`).findings).toHaveLength(1);
  });

  it('ignores a read whose fallback is stated beside it', () => {
    expect(at('src/a.ts', `const x = process.env.CACHE_TTL ?? '60';\n`).findings).toEqual([]);
    expect(at('src/a.ts', `const y = process.env.CACHE_TTL || 60;\n`).findings).toEqual([]);
  });

  it('reports a variable that is defaulted in one place and required in another', () => {
    // One unguarded read makes it required, and only that site is worth citing.
    const { findings } = envFindings('/repo', {
      files: ['/repo/src/a.ts', '/repo/src/b.ts'],
      read: (f) =>
        f.endsWith('a.ts') ? `const x = process.env.TOKEN ?? 'dev';\n` : `const y = process.env.TOKEN;\n`,
      declared: new Set(),
    });
    expect(findings).toHaveLength(1);
    expect(findings[0]!.evidence).toBe('read at src/b.ts:1');
  });

  it('counts an optional read in the denominator, having excluded it from findings', () => {
    const { reads, findings } = at('src/a.ts', `const x = process.env.CACHE_TTL ?? '60';\n`);
    expect(reads).toEqual([{ name: 'CACHE_TTL', file: 'src/a.ts', line: 1, optional: true }]);
    expect(findings).toEqual([]);
  });

  it('ignores a variable that selects the env file, which cannot be declared in it', () => {
    // Measured on this repo: LURQ_ENV_FILE is read by loadEnv() to choose which
    // file to load. Declaring it inside that file is circular, so the finding
    // could never be cleared — a permanent nag rather than a task.
    for (const name of ['LURQ_ENV_FILE', 'DOTENV_CONFIG_PATH', 'ENV_FILE', 'APP_ENV_FILE']) {
      expect(at('src/a.ts', `process.env.${name};\n`).findings, name).toEqual([]);
    }
  });

  it('still reports a variable that merely ends in FILE', () => {
    // The rule is the `_ENV_FILE` suffix, not "anything file-shaped".
    expect(at('src/a.ts', `process.env.UPLOAD_FILE;\n`).findings).toHaveLength(1);
  });
});
