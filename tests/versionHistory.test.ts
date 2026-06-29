import { describe, it, expect } from 'vitest';
import { parseVersionTimeline } from '../src/ingestion/sources/npmRegistry';
import { parseChangeLine } from '../src/pipeline/watch';

describe('parseVersionTimeline', () => {
  const packument = {
    versions: { '1.0.0': {}, '1.1.0': {}, '2.0.0': {} },
    time: {
      created: '2020-01-01T00:00:00Z',
      modified: '2023-01-01T00:00:00Z',
      '1.0.0': '2020-01-01T00:00:00Z',
      '1.1.0': '2021-01-01T00:00:00Z',
      '2.0.0': '2022-01-01T00:00:00Z',
    },
  };

  it('pairs versions with publish dates, newest first', () => {
    const t = parseVersionTimeline(packument);
    expect(t.map((v) => v.version)).toEqual(['2.0.0', '1.1.0', '1.0.0']);
    expect(t[0]!.publishedAt?.getUTCFullYear()).toBe(2022);
  });

  it('ignores the created/modified sentinels', () => {
    expect(parseVersionTimeline(packument)).toHaveLength(3);
  });

  it('returns [] for a malformed packument', () => {
    expect(parseVersionTimeline({})).toEqual([]);
    expect(parseVersionTimeline(null)).toEqual([]);
  });
});

describe('parseChangeLine', () => {
  it('parses a package change record', () => {
    expect(parseChangeLine('{"seq":99,"id":"react","changes":[{"rev":"1-x"}]}')).toEqual({
      seq: 99,
      id: 'react',
      deleted: false,
    });
  });

  it('flags deletions', () => {
    expect(parseChangeLine('{"seq":5,"id":"gone","deleted":true}')?.deleted).toBe(true);
  });

  it('ignores heartbeats and garbage', () => {
    expect(parseChangeLine('')).toBeNull();
    expect(parseChangeLine('   ')).toBeNull();
    expect(parseChangeLine('{"last_seq":42}')).toBeNull(); // no id
    expect(parseChangeLine('not json')).toBeNull();
  });
});
