import { describe, expect, it } from 'vitest';
import { formatError } from '../src/core/errors';

describe('formatError', () => {
  it('truncates long messages', () => {
    const err = new Error('x'.repeat(500));
    const out = formatError(err, 50);
    expect(out.length).toBeLessThanOrEqual(51); // 50 + ellipsis
    expect(out.endsWith('…')).toBe(true);
  });

  it('appends err.cause with PG code when present', () => {
    const cause = Object.assign(new Error('value too long for type'), { code: '22001' });
    const err = new Error('Failed query: insert into "packages" ' + 'y'.repeat(400));
    err.cause = cause;
    const out = formatError(err, 80);
    expect(out).toContain('Failed query:');
    expect(out).toContain('(cause: 22001:');
    expect(out).toContain('value too long');
    expect(out.length).toBeLessThan(200);
  });

  it('handles non-Error values', () => {
    expect(formatError('boom')).toBe('boom');
  });

  it('keeps a packages-insert failure diagnosable without dumping the embedding vector', () => {
    // Mirrors the lurq crash log: Drizzle Failed query + huge params, cause on .cause.
    const cause = Object.assign(new Error('invalid input syntax for type vector'), {
      code: '22P02',
    });
    const embeddingDump = Array.from({ length: 1536 }, (_, i) => String(i * 0.001)).join(',');
    const err = new Error(
      `Failed query: insert into "packages" …\nparams: @prisma/client,[${embeddingDump}]`,
    );
    err.cause = cause;
    const out = formatError(err);
    expect(out).toContain('Failed query:');
    expect(out).toContain('(cause: 22P02:');
    expect(out).toContain('invalid input syntax for type vector');
    expect(out.length).toBeLessThan(700);
    // Truncates the mega params dump (keeps a short prefix only).
    expect(err.message.length).toBeGreaterThan(5_000);
    expect(out.length).toBeLessThan(err.message.length / 10);
  });

  it('formats plain string causes', () => {
    const err = new Error('Failed query: insert');
    err.cause = 'connection terminated unexpectedly';
    expect(formatError(err)).toBe(
      'Failed query: insert (cause: connection terminated unexpectedly)',
    );
  });

  it('omits cause when absent', () => {
    expect(formatError(new Error('simple'))).toBe('simple');
  });
});