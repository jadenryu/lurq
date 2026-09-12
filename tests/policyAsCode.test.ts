import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { hasScope, parseScopes } from '../src/auth/apiKeys';
import { readPolicyFile, runPolicyPush } from '../src/cli/policy';
import { describeRules } from '../src/policy/enforce';
import { DEFAULT_SELECTION_POLICY, type SelectionPolicy } from '../src/policy/types';

const policy = (over: Partial<SelectionPolicy> = {}): SelectionPolicy => ({
  ...DEFAULT_SELECTION_POLICY,
  ...over,
});

describe('parseScopes', () => {
  it('reads an absent field as no extra scopes', () => {
    expect(parseScopes(undefined)).toEqual([]);
    expect(parseScopes(null)).toEqual([]);
  });

  it('accepts known scopes and dedupes them', () => {
    expect(parseScopes(['policy:write', 'policy:write'])).toEqual(['policy:write']);
  });

  it('rejects an unknown scope rather than dropping it', () => {
    // Filtering would mint a key that fails later, far from the request.
    expect(parseScopes(['policy:write', 'admin'])).toBeNull();
    expect(parseScopes('policy:write')).toBeNull();
  });
});

describe('hasScope', () => {
  it('is false for a key minted by setup, which carries none', () => {
    expect(hasScope({ scopes: [] }, 'policy:write')).toBe(false);
    expect(hasScope({ scopes: ['policy:write'] }, 'policy:write')).toBe(true);
  });
});

describe('describeRules', () => {
  it('is empty when nothing is enforced, even with an allowlist', () => {
    expect(describeRules(DEFAULT_SELECTION_POLICY)).toEqual([]);
    expect(describeRules(policy({ allow: ['left-pad'] }))).toEqual([]);
  });

  it('keeps an empty license allowlist distinct from no license rule', () => {
    // compact() strips [] and null alike; the sentence is what keeps them apart.
    expect(describeRules(policy({ licenses: [] }))).toEqual([
      'No license is allowed, so every package with a known license is refused.',
    ]);
    expect(describeRules(policy({ licenses: null, blockDeprecated: true }))).toEqual([
      'No deprecated packages.',
    ]);
  });

  it('carries the deny reason verbatim and lists every active rule', () => {
    const rules = describeRules(
      policy({
        allow: ['moment'],
        deny: [{ name: 'request', reason: 'use undici' }, { name: 'left-pad' }],
        maxAdvisorySeverity: 'moderate',
        minWeeklyDownloads: 10_000,
        maxStaleMonths: 18,
        maxBundleKb: 50,
        minConfidence: 'emerging',
        blockArchived: true,
      }),
    );
    expect(rules).toEqual([
      'Always allowed, whatever else applies: moment.',
      'Never use request: use undici',
      'Never use left-pad.',
      'No packages with a known advisory above moderate.',
      'No packages whose repository is archived.',
      'lurq confidence must be emerging or better.',
      'At least 10,000 weekly downloads.',
      'A release within the last 18 months.',
      'Bundle size at most 50 KB min+gzip.',
    ]);
  });
});

describe('lurq policy push', () => {
  const dir = mkdtempSync(join(tmpdir(), 'lurq-policy-'));
  const file = (name: string, body: string) => {
    const path = join(dir, name);
    writeFileSync(path, body);
    return path;
  };

  it('reads a pulled policy back as the same policy', () => {
    const pulled = file('ok.json', JSON.stringify(policy({ deny: [{ name: 'request' }] })));
    expect(readPolicyFile(pulled)).toEqual(policy({ deny: [{ name: 'request' }] }));
  });

  it('fails --check on an invalid file without touching the network', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    await runPolicyPush(file('partial.json', '{"allow":[]}'), { check: true });
    await runPolicyPush(file('broken.json', '{"allow":'), { check: true });
    expect(process.exitCode).toBe(1);
    expect(fetchSpy).not.toHaveBeenCalled();
    process.exitCode = undefined;
    err.mockRestore();
    fetchSpy.mockRestore();
  });
});
