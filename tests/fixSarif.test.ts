/**
 * SARIF output, checked against the two things that decide whether GitHub code
 * scanning is usable: the rule descriptor stays small, and an alert survives a
 * file being reformatted.
 */
import { describe, expect, it } from 'vitest';
import { ruleClassOf, toSarif } from '../src/fix/sarif';
import type { Edit, Finding } from '../src/fix/types';

const SRC = `import { parse } from 'cookie';\nexport const read = (h: string) => parse(h);\n`;

const opts = { version: '1.2.3', read: () => SRC };

const edit = (over: Partial<Edit> = {}): Edit => ({
  file: 'src/a.ts',
  start: 9,
  end: 14,
  text: 'parseCookie',
  was: 'parse',
  ...over,
});

const finding = (over: Partial<Finding> = {}): Finding => ({
  domain: 'package',
  code: 'renamed-export:cookie:parse',
  severity: 'blocking',
  detail: 'parse was renamed to parseCookie',
  ...over,
});

/** The single run every assertion reads. */
const run = (findings: Finding[]) =>
  (toSarif(findings, opts) as {
    runs: {
      tool: { driver: { rules: { id: string; shortDescription: { text: string } }[]; version: string } };
      results: Record<string, never>[];
    }[];
  }).runs[0]!;

describe('the envelope', () => {
  it('declares SARIF 2.1.0 and attributes the run to a tool version', () => {
    const doc = toSarif([finding()], opts) as { version: string; $schema: string };
    expect(doc.version).toBe('2.1.0');
    expect(doc.$schema).toMatch(/sarif-2\.1\.0/);
    expect(run([finding()]).tool.driver.version).toBe('1.2.3');
  });
});

describe('rules', () => {
  it('describes the class of problem, not each package and symbol', () => {
    // Three findings about three symbols are one rule, or the Security tab
    // fills with thousands of single-instance rules.
    const rules = run([
      finding({ code: 'renamed-export:cookie:parse' }),
      finding({ code: 'renamed-export:cookie:serialize' }),
      finding({ code: 'renamed-export:zod:ZodSchema' }),
    ]).tool.driver.rules;
    expect(rules).toHaveLength(1);
    expect(rules[0]!.id).toBe('renamed-export');
    expect(rules[0]!.shortDescription.text).toMatch(/renamed by the package itself/);
  });

  it('still names a class it has no prose for, rather than omitting the rule', () => {
    const rules = run([finding({ code: 'env-missing:STRIPE_KEY' })]).tool.driver.rules;
    expect(rules[0]!.id).toBe('env-missing');
    expect(rules[0]!.shortDescription.text).toMatch(/env-missing/);
  });

  it('classes a code with no colon as itself', () => {
    expect(ruleClassOf('renamed-export')).toBe('renamed-export');
    expect(ruleClassOf('renamed-export:cookie:parse')).toBe('renamed-export');
  });
});

describe('a deterministic finding', () => {
  const r = () => run([finding({ fix: { summary: 'rename parse to parseCookie', edits: [edit()] } })]).results[0]! as unknown as {
    level: string;
    partialFingerprints: { lurqCode: string };
    properties: { fixable: boolean };
    locations: { physicalLocation: { artifactLocation: { uri: string }; region: Record<string, number> } }[];
    fixes: { artifactChanges: { replacements: { deletedRegion: Record<string, number>; insertedContent: { text: string } }[] }[] }[];
  };

  it('points at the identifier, in 1-based line and column', () => {
    const region = r().locations[0]!.physicalLocation.region;
    // `parse` sits at offset 9 on line 1, so column 10 counting from 1.
    expect(region).toEqual({ startLine: 1, startColumn: 10, endLine: 1, endColumn: 15 });
  });

  it('fingerprints on the finding and file, so a moved line is the same alert', () => {
    expect(r().partialFingerprints.lurqCode).toBe('renamed-export:cookie:parse@src/a.ts');
  });

  it('carries the proven rewrite as a SARIF fix', () => {
    const replacement = r().fixes[0]!.artifactChanges[0]!.replacements[0]!;
    expect(replacement.insertedContent.text).toBe('parseCookie');
    expect(replacement.deletedRegion).toMatchObject({ startLine: 1, startColumn: 10 });
  });

  it('maps blocking to error and marks it fixable', () => {
    expect(r().level).toBe('error');
    expect(r().properties.fixable).toBe(true);
  });
});

describe('a brief', () => {
  const brief = finding({
    code: 'removed-export:cookie:parse',
    severity: 'warning',
    fix: {
      summary: 'replace parse',
      task: { instruction: 'Rewrite each use', files: ['src/a.ts', 'src/b.ts'], evidence: ['parseCookie: function'] },
    },
  });

  it('becomes one result per file it names, so each is its own alert', () => {
    const results = run([brief]).results as unknown as { locations: { physicalLocation: { artifactLocation: { uri: string } } }[] }[];
    expect(results.map((x) => x.locations[0]!.physicalLocation.artifactLocation.uri)).toEqual([
      'src/a.ts',
      'src/b.ts',
    ]);
  });

  it('offers no fix and carries the agent instruction instead', () => {
    const first = run([brief]).results[0]! as unknown as {
      level: string;
      fixes?: unknown;
      properties: { fixable: boolean; agentInstruction: string };
    };
    expect(first.fixes).toBeUndefined();
    expect(first.level).toBe('warning');
    expect(first.properties.fixable).toBe(false);
    expect(first.properties.agentInstruction).toBe('Rewrite each use');
  });
});

describe('degenerate findings', () => {
  it('reports a finding with no file rather than dropping it', () => {
    const results = run([finding({ severity: 'info' })]).results as unknown as { level: string; locations?: unknown }[];
    expect(results).toHaveLength(1);
    expect(results[0]!.locations).toBeUndefined();
    expect(results[0]!.level).toBe('note');
  });

  it('omits the region when the file cannot be read, keeping the alert', () => {
    const doc = toSarif([finding({ fix: { summary: 's', edits: [edit()] } })], {
      version: '1',
      read: () => null,
    }) as { runs: { results: { locations: { physicalLocation: Record<string, unknown> }[] }[] }[] };
    const loc = doc.runs[0]!.results[0]!.locations[0]!.physicalLocation;
    expect(loc.region).toBeUndefined();
    expect(loc.artifactLocation).toMatchObject({ uri: 'src/a.ts' });
  });
});
