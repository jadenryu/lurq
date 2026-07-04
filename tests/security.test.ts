import { describe, it, expect } from 'vitest';
import { editDistance, detectTyposquat, typosquatCorpus } from '../src/security/typosquat';
import { assessRisk, type RiskInput } from '../src/security/risk';

describe('editDistance', () => {
  it('is zero for identical strings', () => {
    expect(editDistance('react', 'react')).toBe(0);
  });
  it('counts single inserts/deletes/substitutions', () => {
    expect(editDistance('reactt', 'react')).toBe(1); // insert
    expect(editDistance('expres', 'express')).toBe(1); // delete
    expect(editDistance('cross-env', 'crossenv')).toBe(1); // delete the dash
  });
  it('counts adjacent transpositions as one edit', () => {
    expect(editDistance('axois', 'axios')).toBe(1);
  });
});

describe('detectTyposquat', () => {
  const popular = ['react', 'cross-env', 'express', 'lodash', 'axios'];

  it('flags a near-miss of a popular name', () => {
    expect(detectTyposquat('crossenv', popular)?.target).toBe('cross-env');
    expect(detectTyposquat('expres', popular)?.target).toBe('express');
    expect(detectTyposquat('axois', popular)?.target).toBe('axios');
  });
  it('never flags the popular package itself', () => {
    expect(detectTyposquat('react', popular)).toBeNull();
    expect(detectTyposquat('express', popular)).toBeNull();
  });
  it('ignores very short names where one edit is noise', () => {
    expect(detectTyposquat('rea', popular)).toBeNull();
  });
  it('returns null when nothing is close', () => {
    expect(detectTyposquat('drizzle-orm', popular)).toBeNull();
  });

  it('catches squats of famous packages on a cold/empty index via the baseline', () => {
    // No tracked packages yet (fresh deploy) — detection must still work.
    const corpus = typosquatCorpus([]);
    expect(detectTyposquat('expres', corpus)?.target).toBe('express');
    expect(detectTyposquat('reactdom', corpus)?.target).toBe('react-dom');
    expect(detectTyposquat('typescriptt', corpus)?.target).toBe('typescript');
  });

  it('de-duplicates the baseline against tracked names', () => {
    const corpus = typosquatCorpus(['react', 'my-private-pkg']);
    expect(corpus.filter((n) => n === 'react')).toHaveLength(1);
    expect(corpus).toContain('my-private-pkg');
  });
});

describe('assessRisk', () => {
  const base: RiskInput = {
    flags: [],
    hasCriticalOrHighAdvisory: false,
    typosquat: false,
    installScripts: false,
    brandNew: false,
    lowTrust: false,
    deprecatedOrArchived: false,
  };

  it('escalates typosquats and critical advisories to high', () => {
    expect(assessRisk({ ...base, typosquat: true })).toBe('high');
    expect(assessRisk({ ...base, hasCriticalOrHighAdvisory: true })).toBe('high');
  });
  it('escalates the brand-new + install-scripts + low-trust fingerprint to high', () => {
    expect(
      assessRisk({ ...base, installScripts: true, brandNew: true, lowTrust: true }),
    ).toBe('high');
  });
  it('treats install scripts on a trusted package as low', () => {
    expect(assessRisk({ ...base, installScripts: true })).toBe('low');
  });
  it('flags deprecated/archived as medium', () => {
    expect(assessRisk({ ...base, deprecatedOrArchived: true })).toBe('medium');
  });
  it('clears a healthy popular package', () => {
    expect(assessRisk(base)).toBe('low');
  });
});
