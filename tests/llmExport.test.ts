import { describe, expect, it } from 'vitest';
import { auditBrief, repoBrief, workspaceBrief } from '../apps/web/src/lib/llm-export';

/**
 * The export is a document handed to an agent that then edits someone's
 * manifests, so the properties worth pinning are not about formatting. They are
 * the three ways a brief can mislead: implying an all-clear for things it did
 * not look at, hiding that a list was truncated, and stating a fix target it
 * does not actually have.
 *
 * `llm-export.ts` imports only types from the web app, and `import type` is
 * erased before this ever runs — so no path alias or DOM environment is needed
 * to test it from here.
 */

const repo = {
  fullName: 'acme/checkout-web',
  defaultBranch: 'main',
  lastScanAt: '2026-09-11T10:00:00.000Z',
  lastScanError: null,
  drift: { depsDeclared: 140, depsTracked: 131 },
  deps: [
    {
      name: 'axios',
      range: '^0.21.0',
      declaredIn: [{ path: 'apps/web/package.json', range: '^0.21.1' }],
      resolved: '0.21.4',
      latest: '1.7.2',
      majorsBehind: 1,
      deprecated: false,
      advisories: 2,
    },
    {
      name: 'zod',
      range: '^3.23.0',
      resolved: '3.23.8',
      latest: '3.23.8',
      majorsBehind: 0,
      deprecated: false,
      advisories: 0,
    },
  ],
  transitiveRisks: [],
  conflicts: [],
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
} as any;

describe('repoBrief', () => {
  it('states coverage, so nothing absent reads as verified', () => {
    const out = repoBrief(repo);
    expect(out).toContain('131 of 140');
    expect(out).toContain('no claim is made about them');
  });

  it('carries the manifest path, which is the edit target', () => {
    expect(repoBrief(repo)).toContain('apps/web/package.json (^0.21.1)');
  });

  it('leaves a clean dependency out of the task list entirely', () => {
    // `zod` is current — listing it would pad the brief an agent has to read.
    expect(repoBrief(repo)).not.toContain('`zod`');
  });

  it('says so when the scan that produced it failed', () => {
    const out = repoBrief({ ...repo, lastScanError: 'manifest parse failed' });
    expect(out).toContain('Last scan FAILED');
    expect(out).toContain('may be stale');
  });

  it('never claims an unscanned repo is clean', () => {
    const out = repoBrief({ ...repo, drift: null, lastScanAt: null, deps: [] });
    expect(out).toContain('no completed scan');
    expect(out).toContain('nothing below is exhaustive');
  });

  it('names an unattributed transitive rather than inventing a fix target', () => {
    const out = repoBrief({
      ...repo,
      transitiveRisks: [
        { name: 'har-validator', version: '5.1.5', latest: null, advisories: 0, deprecated: true, pulledInBy: [] },
      ],
    });
    expect(out).toContain('no attributed parent');
  });
});

describe('workspaceBrief', () => {
  const base = {
    conformance: {
      enforcing: true,
      repos: [
        {
          repoId: 1,
          fullName: 'acme/checkout-web',
          checked: 131,
          unchecked: 9,
          unscored: 0,
          total: 52,
          violations: [{ name: 'axios', rule: 'denied', reason: 'Use the internal client.' }],
        },
      ],
    },
    alerts: [],
    repos: [{ fullName: 'acme/checkout-web', lastScanAt: '2026-09-11T10:00:00.000Z', lastScanError: null }],
    policy: null,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;

  it('admits when a violation list was truncated', () => {
    // 52 found, 1 carried. A brief that printed the one and stopped would read
    // as "one problem", which is the report the VIOLATION_CAP exists to avoid.
    expect(workspaceBrief(base)).toContain('51 more not listed');
  });

  it('distinguishes "no policy" from "everything passed"', () => {
    const out = workspaceBrief({
      ...base,
      conformance: { enforcing: false, repos: [] },
    });
    expect(out).toContain('No selection policy is in force');
    expect(out).not.toMatch(/passes the policy/);
  });

  it('lists never-scanned repos instead of omitting them', () => {
    const out = workspaceBrief({
      ...base,
      repos: [...base.repos, { fullName: 'acme/new-thing', lastScanAt: null, lastScanError: null }],
    });
    expect(out).toContain('Never scanned');
    expect(out).toContain('acme/new-thing');
  });

  it('separates releases a range already admits from ones it holds back', () => {
    const out = workspaceBrief({
      ...base,
      alerts: [
        { packageName: 'chalk', repoFullName: 'a/b', range: '*', fromVersion: '4.1.2', toVersion: '5.0.0', inRange: true },
        { packageName: 'express', repoFullName: 'a/b', range: '^4', fromVersion: '4.18.2', toVersion: '5.0.0', inRange: false },
      ],
    });
    expect(out).toContain('the next clean install takes them');
    expect(out).toContain('Held back by the declared range');
  });
});

describe('auditBrief', () => {
  const events = [
    { id: 'a', kind: 'scan' as const, at: '2026-09-11T10:00:00.000Z', summary: 'scan failed', detail: null, tone: 'bad' as const },
    { id: 'b', kind: 'key' as const, at: '2026-09-10T10:00:00.000Z', summary: 'key created', detail: null, tone: 'neutral' as const },
  ];

  it('states the filter it was taken under', () => {
    const out = auditBrief(events, { range: 'last 7d', kind: 'scan', severity: 'any severity', query: 'acme' });
    expect(out).toContain('last 7d');
    expect(out).toContain('"acme"');
    expect(out).toContain('not included');
  });

  it('puts what needs attention above everything else', () => {
    const out = auditBrief(events, { range: 'all time', kind: 'all', severity: 'any severity', query: '' });
    expect(out.indexOf('Needs attention')).toBeLessThan(out.indexOf('Everything else'));
  });
});
