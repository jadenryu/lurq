import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { hasScope, parseScopes } from '../src/auth/apiKeys';
import { readPolicyFile, runPolicyPush } from '../src/cli/policy';
import {
  applyPolicy,
  check,
  describeRules,
  diffPolicies,
  withoutExpired,
} from '../src/policy/enforce';
import { validateSelectionPolicy } from '../src/policy/parse';
import type { Candidate } from '../src/core/types';
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
    expect(describeRules(policy({ allow: [{ name: 'left-pad' }] }))).toEqual([]);
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
        allow: [{ name: 'moment' }],
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
      'Always allowed: moment.',
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

describe('validateSelectionPolicy', () => {
  const base = { allow: [], deny: [], blockDeprecated: false };

  it('names the field that is wrong, so a hand-edited file can be fixed', () => {
    expect(validateSelectionPolicy({ ...base, maxStaleMonths: 0 })).toEqual({
      error: 'maxStaleMonths must be a number from 1 to 240, or null for no rule.',
    });
    expect(validateSelectionPolicy({ ...base, deny: [{ reason: 'x' }] })).toEqual({
      error: 'deny[0].name must be a string.',
    });
    expect(validateSelectionPolicy({ ...base, mode: 'block' })).toEqual({
      error: 'mode must be enforce or warn.',
    });
  });

  it('refuses an impossible expiry rather than rolling it into next month', () => {
    expect(
      validateSelectionPolicy({ ...base, allow: [{ name: 'a', expires: '2026-02-31' }] }),
    ).toEqual({
      error: 'allow[0].expires must be a date like 2026-12-31.',
    });
  });

  it('reads a policy written before mode, exception objects and the age rule existed', () => {
    expect(validateSelectionPolicy({ ...base, allow: ['left-pad'] })).toEqual({
      policy: policy({ allow: [{ name: 'left-pad' }] }),
    });
  });
});

describe('warn mode', () => {
  it('keeps the candidate and reports what would have been refused', () => {
    const request = { name: 'request', confidence: 'proven' } as Candidate;
    const out = applyPolicy(
      policy({ mode: 'warn', deny: [{ name: 'request' }] }),
      [request],
      new Map(),
    );
    expect(out.allowed).toEqual([request]);
    expect(out.excluded).toEqual([]);
    expect(out.warned.map((w) => w.rule)).toEqual(['denied']);
  });
});

describe('expiring exceptions', () => {
  it('treats expires as the first day the exception no longer applies', () => {
    const p = policy({
      allow: [
        { name: 'lapsed', expires: '2026-09-12' },
        { name: 'current', expires: '2026-09-13' },
        { name: 'permanent' },
      ],
    });
    const enforced = withoutExpired(p, new Date('2026-09-12T10:00:00Z'));
    expect(enforced.allow.map((a) => a.name)).toEqual(['current', 'permanent']);
  });
});

describe('package age rule', () => {
  const p = policy({ minPackageAgeDays: 30 });
  const pkg = (name: string) => ({ name, confidence: 'proven' as const });
  const facts = (daysSincePublished: number | null) => ({
    license: null,
    deprecated: false,
    daysSincePublished,
  });

  it('refuses a package younger than the cool-down', () => {
    expect(check(p, pkg('fresh'), facts(3))?.rule).toBe('age');
  });

  it('lets a package through on the day it reaches the cool-down', () => {
    expect(check(p, pkg('ripe'), facts(30))).toBeNull();
  });

  it('never convicts on an unknown publish date', () => {
    expect(check(p, pkg('unknown'), facts(null))).toBeNull();
  });
});

describe('diffPolicies', () => {
  it('reads as the rules removed and added', () => {
    expect(
      diffPolicies(policy({ deny: [{ name: 'request' }] }), policy({ blockDeprecated: true })),
    ).toEqual(['- Never use request.', '+ No deprecated packages.']);
  });

  it('shows a switch to warn mode, the one change that loosens every rule at once', () => {
    expect(
      diffPolicies(
        policy({ blockDeprecated: true }),
        policy({ blockDeprecated: true, mode: 'warn' }),
      ),
    ).toEqual(['+ Warn only: packages that break these rules are reported, not refused.']);
  });

  it('is empty when nothing changed', () => {
    expect(diffPolicies(policy(), policy())).toEqual([]);
  });
});
