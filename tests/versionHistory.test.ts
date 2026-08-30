import { describe, it, expect } from 'vitest';
import { parseVersionTimeline } from '../src/ingestion/sources/npmRegistry';
import { parseChange, parseChangesPage, routeChange } from '../src/pipeline/watch';

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

describe('parseChange', () => {
  it('parses a package change record', () => {
    expect(parseChange({ seq: 99, id: 'react', changes: [{ rev: '1-x' }] })).toEqual({
      seq: 99,
      id: 'react',
      deleted: false,
    });
  });

  it('flags deletions', () => {
    expect(parseChange({ seq: 5, id: 'gone', deleted: true })?.deleted).toBe(true);
  });

  it('rejects anything without both a seq and a string id', () => {
    expect(parseChange({ last_seq: 42 })).toBeNull(); // no id
    expect(parseChange({ seq: 1 })).toBeNull();
    expect(parseChange({ id: 'x' })).toBeNull(); // no seq
    expect(parseChange({ seq: 1, id: 42 })).toBeNull(); // id not a string
    expect(parseChange(null)).toBeNull();
    expect(parseChange('not an object')).toBeNull();
  });
});

describe('parseChangesPage', () => {
  it('reads results and the resume point off a page', () => {
    const page = parseChangesPage({
      results: [
        { seq: 1, id: 'a', changes: [] },
        { seq: 2, id: 'b', deleted: true },
      ],
      last_seq: 2,
    });
    expect(page.changes.map((c) => c.id)).toEqual(['a', 'b']);
    expect(page.lastSeq).toBe('2');
  });

  it('drops malformed entries without losing the rest of the page', () => {
    const page = parseChangesPage({
      results: [{ seq: 1, id: 'a' }, null, { nope: true }],
      last_seq: 9,
    });
    expect(page.changes).toHaveLength(1);
    expect(page.lastSeq).toBe('9');
  });

  it('treats an unreadable body as an empty page, so the caller retries the cursor', () => {
    // A 200 with a body we cannot parse must not advance the cursor past changes
    // we never processed — lastSeq null is what keeps it pinned.
    for (const body of [null, 'nope', {}, { results: 'not-an-array' }]) {
      expect(parseChangesPage(body)).toEqual({ changes: [], lastSeq: null });
    }
  });
});

describe('routeChange (the growth branch)', () => {
  const tracked = new Set(['react']);
  const queued = new Set(['already-waiting']);
  const change = (id: string, deleted = false) => ({ seq: 1, id, deleted });

  it('re-syncs a package we already track', () => {
    expect(routeChange(change('react'), tracked, queued)).toBe('resync');
  });

  it('enqueues a name nobody has seen — this is the whole growth channel', () => {
    expect(routeChange(change('brand-new-pkg'), tracked, queued)).toBe('enqueue');
  });

  it('skips a name already waiting on the merit gate', () => {
    expect(routeChange(change('already-waiting'), tracked, queued)).toBe('skip');
  });

  it('skips unpublishes, even for a name we have never seen', () => {
    expect(routeChange(change('brand-new-pkg', true), tracked, queued)).toBe('skip');
    expect(routeChange(change('react', true), tracked, queued)).toBe('skip');
  });
});
