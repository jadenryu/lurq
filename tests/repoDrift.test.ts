import { describe, it, expect } from 'vitest';
import { declaredDeps, depDrift } from '../src/github/drift';
import { manifestPaths, parseManifest } from '../src/github/manifests';
import { appJwt } from '../src/github/app';
import { generateKeyPairSync, createVerify } from 'node:crypto';

const indexed = (latest: string | null, extra: Partial<{ deprecated: boolean; advisories: number }> = {}) => ({
  latestVersion: latest,
  deprecated: extra.deprecated ?? false,
  advisories: extra.advisories ?? 0,
});

describe('depDrift', () => {
  it('reports no drift when the declared range already admits latest', () => {
    // The bug this guards: measuring from the range floor (6.4.0) instead of
    // what a fresh install resolves to (6.9.2) invents drift on current repos.
    const dep = depDrift('react-router', '^6.4.0', indexed('6.9.2'), ['6.4.0', '6.9.2']);
    expect(dep.resolved).toBe('6.9.2');
    expect(dep.majorsBehind).toBe(0);
  });

  it('counts majors between the resolved version and latest', () => {
    const dep = depDrift('react-router', '^6.4.0', indexed('8.1.0'), ['6.4.0', '6.9.2', '7.0.0', '8.1.0']);
    expect(dep.resolved).toBe('6.9.2');
    expect(dep.majorsBehind).toBe(2);
  });

  it('never reports negative drift when the repo is ahead of the index', () => {
    const dep = depDrift('next', '^17.0.0', indexed('16.4.0'), ['16.4.0', '17.0.1']);
    expect(dep.majorsBehind).toBe(0);
  });

  it('falls back to the range floor when the index has no version timeline', () => {
    const dep = depDrift('zod', '^3.23.8', indexed('4.0.1'), []);
    expect(dep.resolved).toBe('3.23.8');
    expect(dep.majorsBehind).toBe(1);
  });

  it('carries deprecation and advisory counts through', () => {
    const dep = depDrift('request', '^2.88.0', indexed('2.88.2', { deprecated: true, advisories: 3 }), ['2.88.0', '2.88.2']);
    expect(dep.deprecated).toBe(true);
    expect(dep.advisories).toBe(3);
  });
});

describe('declaredDeps', () => {
  it('keeps the lowest declared range across workspaces', () => {
    const merged = declaredDeps([
      { path: 'package.json', deps: { react: '^19.0.0' } },
      { path: 'packages/api/package.json', deps: { react: '^18.2.0' } },
    ]);
    expect(merged.get('react')).toBe('^18.2.0');
  });
});

describe('parseManifest', () => {
  it('merges dependencies and devDependencies', () => {
    const parsed = parseManifest('package.json', {
      dependencies: { react: '^19.0.0' },
      devDependencies: { vitest: '^2.0.0' },
    });
    expect(parsed?.deps).toEqual({ react: '^19.0.0', vitest: '^2.0.0' });
  });

  it('drops specifiers that never resolve to a registry version', () => {
    const parsed = parseManifest('package.json', {
      dependencies: {
        real: '^1.0.0',
        local: 'file:../thing',
        ws: 'workspace:*',
        forked: 'github:me/thing',
        tarball: 'https://example.com/a.tgz',
      },
    });
    expect(Object.keys(parsed?.deps ?? {})).toEqual(['real']);
  });

  it('returns null for a manifest with no dependencies', () => {
    expect(parseManifest('package.json', { name: 'x' })).toBeNull();
  });
});

describe('manifestPaths', () => {
  it('finds workspace manifests, skips node_modules, and puts the root first', () => {
    const paths = manifestPaths([
      { path: 'packages/api/package.json', type: 'blob' },
      { path: 'node_modules/left-pad/package.json', type: 'blob' },
      { path: 'package.json', type: 'blob' },
      { path: 'src/package.json.bak', type: 'blob' },
      { path: 'packages', type: 'tree' },
    ]);
    expect(paths).toEqual(['package.json', 'packages/api/package.json']);
  });
});

describe('appJwt', () => {
  it('produces an RS256 JWT the public key verifies', () => {
    const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
    const token = appJwt(
      { appId: '12345', privateKey: privateKey.export({ type: 'pkcs1', format: 'pem' }).toString() },
      new Date('2026-08-07T00:00:00Z'),
    );
    const [header, payload, signature] = token.split('.');
    expect(JSON.parse(Buffer.from(header!, 'base64url').toString())).toEqual({ alg: 'RS256', typ: 'JWT' });

    const claims = JSON.parse(Buffer.from(payload!, 'base64url').toString());
    expect(claims.iss).toBe('12345');
    // Backdated iat tolerates clock skew; exp stays inside GitHub's 10-minute cap.
    expect(claims.exp - claims.iat).toBeLessThanOrEqual(600);
    expect(claims.iat).toBeLessThan(Math.floor(Date.parse('2026-08-07T00:00:00Z') / 1000));

    const verified = createVerify('RSA-SHA256')
      .update(`${header}.${payload}`)
      .verify(publicKey, Buffer.from(signature!, 'base64url'));
    expect(verified).toBe(true);
  });
});
