/**
 * The upkeep plan an agent asks for mid-edit.
 *
 * The property worth pinning is not that it finds things — the detectors have
 * their own tests — but that it never lets "never looked" read as "nothing
 * wrong". A model handed an empty result concludes the project is clean, so a
 * domain that was skipped, failed, or does not exist has to say so.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { handleUpkeep } from '../src/mcp/upkeepHandler';

let root: string;

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'lurq-upkeep-'));
  mkdirSync(join(root, 'src'), { recursive: true });
  writeFileSync(join(root, 'package.json'), '{"name":"u","private":true}', 'utf8');
  writeFileSync(join(root, 'src/a.ts'), 'export const k = process.env.STRIPE_KEY;\n', 'utf8');
  writeFileSync(join(root, '.env.example'), 'OTHER=1\n', 'utf8');
});

afterAll(() => rmSync(root, { recursive: true, force: true }));

describe('the env domain', () => {
  it('runs with no key, no network and no arguments', async () => {
    const report = await handleUpkeep({ dir: root, domains: ['env'] });
    expect(report.ran).toEqual(['env']);
    expect(report.findings.map((f) => f.code)).toEqual(['env-undeclared:STRIPE_KEY']);
  });

  it('reports the root it actually read, not the one it was asked for', async () => {
    expect((await handleUpkeep({ dir: root, domains: ['env'] })).root).toBe(root);
  });
});

describe('never silently empty', () => {
  it('skips the package domain with a reason when given no upgrades', async () => {
    // The failure this guards: a model seeing `findings: []` and concluding the
    // dependencies are fine, when nothing was ever assessed.
    const report = await handleUpkeep({ dir: root, domains: ['package'] });
    expect(report.ran).toEqual([]);
    expect(report.skipped[0]!.domain).toBe('package');
    expect(report.skipped[0]!.reason).toMatch(/no upgrades given/);
  });

  it('names a domain that has no detector yet rather than returning nothing', async () => {
    const report = await handleUpkeep({ dir: root, domains: ['api'] });
    expect(report.findings).toEqual([]);
    expect(report.skipped[0]).toMatchObject({ domain: 'api' });
    expect(report.skipped[0]!.reason).toMatch(/no detector/);
  });

  it('counts a domain that found nothing as RAN, not as skipped', async () => {
    // The distinction this whole report exists for, from the other side: a
    // domain that looked and found nothing is a clean answer, and must not be
    // reported the same way as one that never looked.
    //
    // Deliberately no "domain throws" case here: checkUpgradeOne returns a
    // requirements-only answer when a scan finds no references, so a bad
    // directory does not throw, and there is no cheap way to force one without
    // mocking the detector. Asserting a catch that never fires would be worse
    // than leaving it to inspection.
    const empty = mkdtempSync(join(tmpdir(), 'lurq-upkeep-clean-'));
    try {
      writeFileSync(join(empty, 'package.json'), '{"name":"c","private":true}', 'utf8');
      const report = await handleUpkeep({ dir: empty, domains: ['env'] });
      expect(report.ran).toEqual(['env']);
      expect(report.findings).toEqual([]);
      expect(report.skipped).toEqual([]);
    } finally {
      rmSync(empty, { recursive: true, force: true });
    }
  });
});

describe('defaults', () => {
  it('runs every domain that has a detector', async () => {
    const report = await handleUpkeep({ dir: root });
    expect(report.ran).toContain('env');
    // package is attempted and skipped for want of upgrades — attempted, not ignored.
    expect(report.skipped.map((s) => s.domain)).toContain('package');
  });

  it('reports truncation rather than folding it into a clean answer', async () => {
    const report = await handleUpkeep({ dir: root, domains: ['env'] });
    expect(report.truncated).toBe(false);
  });
});
