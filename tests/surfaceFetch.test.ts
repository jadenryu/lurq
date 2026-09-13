import { describe, it, expect } from 'vitest';
import { createHash } from 'node:crypto';
import { resolveTarball, verifyIntegrity } from '../src/surface/fetch';

/** A fetch that answers from a queue of statuses, then keeps repeating the last. */
function scripted(statuses: number[]): { fetchImpl: typeof fetch; calls: () => number } {
  let n = 0;
  const fetchImpl = (async () => {
    const status = statuses[Math.min(n++, statuses.length - 1)]!;
    const body = status === 200 ? { version: '1.0.0', dist: { tarball: 'https://t/x.tgz', integrity: 'sha512-abc' } } : {};
    return new Response(JSON.stringify(body), { status, headers: { 'retry-after': '0' } });
  }) as typeof fetch;
  return { fetchImpl, calls: () => n };
}

describe('registry resolution', () => {
  // A registry hiccup is not evidence about a package.
  it('retries a 503 and resolves', async () => {
    const { fetchImpl, calls } = scripted([503, 200]);
    const dist = await resolveTarball('x', '1.0.0', fetchImpl);
    expect(dist).toEqual({ tarball: 'https://t/x.tgz', version: '1.0.0', integrity: 'sha512-abc' });
    expect(calls()).toBe(2);
  });

  it('reads a 404 as not published', async () => {
    expect(await resolveTarball('x', '9.9.9', scripted([404]).fetchImpl)).toBeNull();
  });

  // "Not published" would send someone hunting for a release that exists.
  it('throws on any other refusal rather than reporting the version missing', async () => {
    await expect(resolveTarball('x', '1.0.0', scripted([403]).fetchImpl)).rejects.toThrow(/403/);
  });
});

describe('tarball integrity', () => {
  const buf = Buffer.from('package bytes');
  const sha512 = `sha512-${createHash('sha512').update(buf).digest('base64')}`;
  const sha1 = createHash('sha1').update(buf).digest('hex');

  it('accepts the bytes the registry published', () => {
    expect(() => verifyIntegrity(buf, { integrity: sha512 }, 'x@1')).not.toThrow();
    expect(() => verifyIntegrity(buf, { shasum: sha1 }, 'x@1')).not.toThrow();
  });

  it('refuses anything else', () => {
    expect(() => verifyIntegrity(Buffer.from('tampered'), { integrity: sha512 }, 'x@1')).toThrow(/integrity mismatch/);
    expect(() => verifyIntegrity(Buffer.from('tampered'), { shasum: sha1 }, 'x@1')).toThrow(/shasum mismatch/);
  });
});
