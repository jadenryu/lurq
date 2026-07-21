import { describe, it, expect } from 'vitest';
import { extractJsonObject, parseStackProposalJson } from '../../src/benchmark/participants/agentLoop';

describe('parseStackProposalJson', () => {
  const valid = `{
  "selections": [
    {
      "needId": "typescript",
      "package": "typescript",
      "requestedVersion": "5.9.2",
      "scopeHint": "development",
      "category": "build-tool",
      "lurqHealthScore": null,
      "lurqConfidence": null,
      "lurqSwappedFrom": null,
      "source": "unaided-model"
    }
  ],
  "unmatchedNeedIds": []
}`;

  it('parses Claude-style fenced JSON that previously emptied via greedy strip', () => {
    const raw = '```json\n' + valid + '\n```';
    const parsed = parseStackProposalJson(raw, 'model-with-lurq');
    expect(parsed.selections).toHaveLength(1);
    expect(parsed.selections[0].package).toBe('typescript');
    expect(parsed.selections[0].source).toBe('model-with-lurq');
  });

  it('parses fenced JSON with prose before the fence', () => {
    const raw =
      'React Router v8 requires Node ≥22, so I will use v7.\n\n```json\n' +
      valid +
      '\n```';
    const parsed = parseStackProposalJson(raw, 'model-with-lurq');
    expect(parsed.unmatchedNeedIds).toEqual([]);
  });

  it('extractJsonObject rejects truncated JSON instead of inventing braces', () => {
    expect(() =>
      extractJsonObject('```json\n{"selections":[{"needId":"a","package":"x","lurqSwappedFrom": nu'),
    ).toThrow(/Incomplete JSON|No JSON/);
  });
});
