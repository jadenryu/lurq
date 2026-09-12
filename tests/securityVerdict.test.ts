/**
 * The safety call, and the four ways it used to be wrong.
 *
 * Each `describe` below is a defect that shipped. They share one root cause:
 * lurq had several code paths deriving "is this safe" from overlapping inputs,
 * and every one of them treated absent evidence as good news. A tool that
 * answers the same question three ways has not answered it, and the
 * disagreement always surfaced where the evidence was thinnest — which is
 * exactly where a user is relying on it most.
 */
import { describe, expect, it } from 'vitest';
import { assessVerdict, verdictHeadline } from '../src/security/verdict';
import { computeConfidence } from '../src/scoring/score';
import type { Advisory } from '../src/core/types';

const adv = (severity: Advisory['severity'], id = `GHSA-${severity}`): Advisory => ({
  id,
  severity,
  summary: 's',
});

describe('a security finding overrides the quality signals', () => {
  /**
   * The reported bug. A moderate advisory added a `has-known-advisory` flag and
   * left the level at `low`, so one response said both "has a known advisory"
   * and "✓ looks safe".
   */
  it('never calls a package with any advisory safe', () => {
    const v = assessVerdict({ exists: true, advisories: [adv('moderate')] });
    expect(v.level).toBe('medium');
    expect(v.reassuring).toBe(false);
    expect(v.reasons.join(' ')).toMatch(/advisory/);
  });

  it('escalates a critical or high advisory to the top level', () => {
    expect(assessVerdict({ exists: true, advisories: [adv('critical')] }).level).toBe('high');
    expect(assessVerdict({ exists: true, advisories: [adv('high')] }).level).toBe('high');
  });

  it('escalates a vulnerability in the exact installed version', () => {
    const v = assessVerdict({
      exists: true,
      advisories: [],
      versionVulns: ['GHSA-72xf-g2v4-qvf3'],
    });
    expect(v.level).toBe('high');
    expect(v.reassuring).toBe(false);
  });

  // Popularity is not safety. A package can be enormous, well maintained, and
  // still be the one you must not install today.
  it('does not let adoption or maintenance soften a finding', () => {
    const v = assessVerdict({
      exists: true,
      advisories: [adv('critical')],
      lowTrust: false,
      deprecated: false,
      archived: false,
    });
    expect(v.level).toBe('high');
  });

  it('flags the malware fingerprint even with no advisory on record', () => {
    const v = assessVerdict({
      exists: true,
      advisories: [],
      installScripts: true,
      brandNew: true,
      lowTrust: true,
    });
    expect(v.level).toBe('high');
    expect(v.reasons.join(' ')).toMatch(/malicious/);
  });

  /**
   * `emerging` was the one confidence tier that never consulted advisories, so
   * a fast-growing package with a critical CVE could be labelled emerging and
   * recommended on adoption alone — the tier most likely to be applied to
   * something nobody has audited yet.
   */
  it('will not label a package with a critical advisory as emerging', () => {
    const now = new Date('2026-09-12T00:00:00Z');
    const base = {
      weeklyDownloads: 50_000,
      firstPublishedAt: new Date('2025-01-01T00:00:00Z'),
      lastReleaseAt: new Date('2026-08-01T00:00:00Z'),
      downloadGrowth90d: 0.5,
      deprecated: false,
      archived: false,
      scorecard: null,
    };
    expect(computeConfidence({ ...base, advisories: [] } as never, now)).not.toBe('unproven');
    expect(computeConfidence({ ...base, advisories: [adv('critical')] } as never, now)).toBe(
      'unproven',
    );
  });
});

describe('unknown is not clean', () => {
  /**
   * `advisories` is NULL until a package has been analysed and `[]` afterwards.
   * Every read site collapsed the two with `?? []`, so a package nobody had
   * looked at reported "0 advisories" — missing evidence rendered as a clean
   * bill, which is the most dangerous shape a wrong answer can take.
   */
  it('refuses to reassure when advisories have not been checked', () => {
    const v = assessVerdict({ exists: true, advisories: null });
    expect(v.level).toBe('low');
    // Low, because nothing was found — but NOT reassuring, because nothing was
    // looked at. The renderers key off `reassuring`, never off `level`.
    expect(v.reassuring).toBe(false);
    expect(v.complete).toBe(false);
    expect(v.unknowns.join(' ')).toMatch(/not been checked/);
  });

  it('reports the advisory count as null, never as zero, when unchecked', () => {
    expect(assessVerdict({ exists: true, advisories: null }).advisoryCount).toBeNull();
    expect(assessVerdict({ exists: true, advisories: [] }).advisoryCount).toBe(0);
  });

  it('reassures only when the package was actually analysed and was clean', () => {
    const v = assessVerdict({ exists: true, advisories: [] });
    expect(v.reassuring).toBe(true);
    expect(v.complete).toBe(true);
    expect(v.reasons).toEqual([]);
  });

  it('withholds reassurance when a vulnerability lookup did not complete', () => {
    const v = assessVerdict({ exists: true, advisories: [], vulnLookupComplete: false });
    expect(v.reassuring).toBe(false);
    expect(v.unknowns.join(' ')).toMatch(/did not complete/);
  });

  it('says so in the headline rather than implying a clean result', () => {
    expect(verdictHeadline(assessVerdict({ exists: true, advisories: null }))).toMatch(
      /incomplete/,
    );
    expect(verdictHeadline(assessVerdict({ exists: true, advisories: [] }))).toMatch(/no supply/);
  });
});

describe('a name that does not exist is invalid input, not a risk score', () => {
  /**
   * Calling a nonexistent package "high risk" invites the reader to weigh risk
   * against benefit. There is no package here to weigh — the correct action is
   * to stop using the name, which is usually a hallucination or a typo.
   */
  it('answers invalid rather than high', () => {
    const v = assessVerdict({ exists: false, advisories: null });
    expect(v.level).toBe('invalid');
    expect(v.reassuring).toBe(false);
    expect(v.reasons.join(' ')).toMatch(/no such package/);
  });

  it('names the package it was probably meant to be', () => {
    const v = assessVerdict({ exists: false, advisories: null, typosquatOf: 'request' });
    expect(v.level).toBe('invalid');
    expect(v.reasons.join(' ')).toMatch(/mimics "request"/);
    expect(v.reasons.join(' ')).toMatch(/typosquat/);
  });

  // `invalid` deliberately sits outside RiskLevel so no caller can fold it into
  // the risk ladder and lose the one fact that matters.
  it('is not one of the risk levels', () => {
    expect(['low', 'medium', 'high']).not.toContain(
      assessVerdict({ exists: false, advisories: null }).level,
    );
  });

  it('reports no advisory count, since there is no package to have any', () => {
    expect(assessVerdict({ exists: false, advisories: null }).advisoryCount).toBeNull();
  });
});

describe('one question, one answer', () => {
  /**
   * The fourth defect: verify, evaluate and audit each derived safety
   * separately and disagreed. They now all call this, so the guarantee is
   * structural rather than a convention someone has to remember.
   */
  it('is a pure function of its inputs, so every caller agrees', () => {
    const input = {
      exists: true,
      advisories: [adv('moderate')],
      deprecated: true,
      lowTrust: true,
    };
    expect(assessVerdict(input)).toEqual(assessVerdict({ ...input }));
  });

  it('gives the same answer whether a caller supplies extra context or not', () => {
    // Adding quality context must not change a security conclusion.
    const bare = assessVerdict({ exists: true, advisories: [adv('critical')] });
    const rich = assessVerdict({
      exists: true,
      advisories: [adv('critical')],
      lowTrust: false,
      singleMaintainer: false,
      installScripts: false,
    });
    expect(rich.level).toBe(bare.level);
    expect(rich.reassuring).toBe(bare.reassuring);
  });
});

describe('a verdict says which version it is about', () => {
  /**
   * The surfaces agreed and still misled. `verify vitest` answers about the
   * latest release and says "no problems found"; the audit answers about the
   * 2.1.9 in your node_modules and says "vulnerable". Both are correct, and
   * they read as a contradiction because neither said what it was describing.
   */
  it('distinguishes the latest release from what is installed', () => {
    const latest = assessVerdict({ exists: true, advisories: [], subjectVersion: '4.1.10' });
    const installed = assessVerdict({
      exists: true,
      advisories: [],
      versionVulns: ['GHSA-5xrq-8626-4rwp'],
      subjectVersion: '2.1.9',
      subjectInstalled: true,
    });
    expect(latest.scope).toBe('4.1.10 (latest)');
    expect(installed.scope).toBe('the installed 2.1.9');
    // Not a contradiction once each states its subject.
    expect(latest.reassuring).toBe(true);
    expect(installed.level).toBe('high');
  });

  it('puts the subject in the headline, so a clean bill cannot be over-read', () => {
    const v = assessVerdict({ exists: true, advisories: [], subjectVersion: '4.1.10' });
    expect(verdictHeadline(v)).toContain('4.1.10 (latest)');
  });

  it('degrades to words when no version is known', () => {
    expect(assessVerdict({ exists: true, advisories: [] }).scope).toBe(
      'the latest published version',
    );
    expect(assessVerdict({ exists: true, advisories: [], subjectInstalled: true }).scope).toBe(
      'the installed version',
    );
  });
});
