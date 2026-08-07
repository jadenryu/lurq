import { describe, it, expect } from 'vitest';
import { compact } from '../src/mcp/compact';

describe('compact', () => {
  it('drops null and undefined fields', () => {
    expect(compact({ a: 1, b: null, c: undefined })).toEqual({ a: 1 });
  });

  it('keeps false and 0 — they carry signal', () => {
    expect(compact({ deprecated: false, weeklyDownloads: 0 })).toEqual({
      deprecated: false,
      weeklyDownloads: 0,
    });
  });

  it('drops empty arrays but keeps non-empty ones', () => {
    expect(compact({ advisories: [], flags: ['x'] })).toEqual({ flags: ['x'] });
  });

  it('recurses into nested objects and drops those left empty', () => {
    expect(compact({ breakdown: { m: 90, efficiency: null, quality: null }, gone: { x: null } })).toEqual({
      breakdown: { m: 90 },
    });
  });

  it('cleans objects inside arrays', () => {
    expect(compact({ rows: [{ name: 'a', q: null }, { name: 'b', q: 5 }] })).toEqual({
      rows: [{ name: 'a' }, { name: 'b', q: 5 }],
    });
  });

  it('preserves string and number leaves', () => {
    expect(compact({ summary: 'hi', score: 88.5 })).toEqual({ summary: 'hi', score: 88.5 });
  });

  // A Date has no own keys — without a guard it reads as an empty object and
  // any handler returning a raw DB row would silently lose its timestamps.
  it('preserves Date values, nested and in arrays', () => {
    const at = new Date('2026-01-01T00:00:00.000Z');
    expect(compact({ ranAt: at, rows: [{ at }], gone: null })).toEqual({
      ranAt: at,
      rows: [{ at }],
    });
  });
});
