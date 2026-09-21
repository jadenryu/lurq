/**
 * The one-paste autopilot setup brief.
 *
 * What is pinned: the key is only ever present when minted and then labelled
 * live, the brief delegates to the CLI instead of inlining YAML that drifts,
 * and pr mode never sends an agent into an interactive sign-in it cannot finish.
 */
import { describe, expect, it } from 'vitest';
import { setupCommand, setupPrompt, type SetupInput } from '../apps/web/src/lib/agent-setup';

const input = (over: Partial<SetupInput> = {}): SetupInput => ({
  repos: ['acme/web', 'acme/api'],
  mode: 'fix',
  keysUrl: 'https://www.lurq.run/dashboard/keys',
  ...over,
});

describe('setupPrompt', () => {
  it('names every repository in one command', () => {
    const text = setupPrompt(input());
    expect(text).toContain('npx lurqrun autopilot init --mode fix --repo acme/web acme/api');
    expect(setupCommand(input())).toBe(
      'npx lurqrun autopilot init --mode fix --repo acme/web acme/api',
    );
  });

  it('delegates to the CLI rather than inlining the workflow', () => {
    // An inlined copy drifts from the template the day the template changes.
    const text = setupPrompt(input());
    expect(text).not.toMatch(/runs-on:|permissions:/);
  });

  it('checks the gh workflow scope first', () => {
    expect(setupPrompt(input())).toContain('gh auth refresh -s workflow');
  });

  it('carries no key unless one was minted', () => {
    const text = setupPrompt(input());
    expect(text).not.toContain('LIVE credential');
    expect(text).toContain('npx lurqrun setup');
  });

  it('labels a minted key live and passes it by environment, not argument', () => {
    // Not key-shaped on purpose: gitleaks flags realistic fixtures, rightly.
    const text = setupPrompt(input({ apiKey: 'EXAMPLE-NOT-A-REAL-KEY' }));
    expect(text).toContain('EXAMPLE-NOT-A-REAL-KEY');
    expect(text).toMatch(/LIVE credential/);
    expect(text).toContain('LURQ_API_KEY=<key> npx lurqrun');
    expect(text).not.toContain('--api-key');
    expect(text).toContain('https://www.lurq.run/dashboard/keys');
  });

  it('skips the interactive token mint in pr mode and asks for a credential per repo', () => {
    const text = setupPrompt(input({ mode: 'pr' }));
    expect(text).toContain('--no-credential');
    expect(text).toContain('gh secret set ANTHROPIC_API_KEY --repo acme/web');
    expect(text).toContain('gh secret set ANTHROPIC_API_KEY --repo acme/api');
    expect(text).toMatch(/EXPIRES ONE YEAR/);
  });

  it('asks for no Anthropic credential in fix mode', () => {
    expect(setupPrompt(input())).not.toContain('ANTHROPIC_API_KEY');
  });
});
