import { describe, it, expect } from 'vitest';
import { editDistance, detectTyposquat, typosquatCorpus } from '../src/security/typosquat';

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

/**
 * `assessRisk` is gone; `src/security/verdict.ts` replaced it and
 * tests/securityVerdict.test.ts covers the rules. It was deleted rather than
 * left in place because it had a defect worth not leaving callable: any
 * advisory below critical/high returned `low`, so a package with a known
 * moderate CVE came back as "no supply-chain red flags". Anything still
 * importing it would quietly get that answer back.
 */
