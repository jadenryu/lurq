/**
 * The account-wide setup brief.
 *
 * Its sibling, `agentSetupPrompt`, hands over a rendered workflow because the
 * dashboard has one per repo. This one cannot — no file exists until a repo is
 * connected — so it delegates to `lurq autopilot-init`, which renders locally.
 * That delegation is the whole design, and a future edit that "helpfully"
 * inlined YAML here would reintroduce the problem the command was added to fix.
 *
 * Two properties matter more than the wording. It must name what an agent
 * CANNOT do rather than omitting it, because the two omitted steps — installing
 * the App and committing the workflow — are exactly the ones carrying a
 * decision a person should make. And a key travels only when one was minted.
 */
import { describe, expect, it } from 'vitest';
import { accountSetupPrompt, type AccountSetupInput } from '../apps/web/src/lib/agent-setup';

const input = (over: Partial<AccountSetupInput> = {}): AccountSetupInput => ({
  repos: ['acme/web', 'acme/api'],
  keysUrl: 'https://www.lurq.run/dashboard/keys',
  ...over,
});

describe('accountSetupPrompt', () => {
  it('delegates the workflow to the CLI instead of inlining YAML', () => {
    // The reason `autopilot-init` exists. Inlining a generic file here would
    // lose each repo's package manager, which is what the command detects.
    const text = accountSetupPrompt(input());
    expect(text).toContain('npx lurqrun autopilot-init');
    expect(text).not.toContain('runs-on: ubuntu-latest');
    expect(text).not.toContain('permissions:');
  });

  it('lists every repository it is being asked to set up', () => {
    const text = accountSetupPrompt(input({ repos: ['acme/web', 'acme/api', 'acme/cli'] }));
    expect(text).toContain('(3)');
    for (const repo of ['acme/web', 'acme/api', 'acme/cli']) expect(text).toContain(repo);
  });

  it('says what it cannot do, rather than leaving it out', () => {
    // Both omitted steps carry a decision: consent on github.com, and the
    // commit that grants write access. A brief that silently skipped them
    // would be doing the two things the user should decide.
    const text = accountSetupPrompt(input());
    expect(text).toContain('What you cannot do');
    expect(text).toMatch(/install the lurq GitHub App/);
    expect(text).toMatch(/commit the workflow/);
  });

  it('tells the agent to stop before pushing', () => {
    const text = accountSetupPrompt(input());
    expect(text).toMatch(/STOP/);
    expect(text).toMatch(/Do not push/);
  });

  it('counts repositories lurq has not seen when there are any', () => {
    expect(accountSetupPrompt(input({ unconnected: 3 }))).toContain('connect 3 repositories');
    expect(accountSetupPrompt(input({ unconnected: 1 }))).toContain('connect 1 repository');
    expect(accountSetupPrompt(input())).toContain('connect any further repositories');
  });

  it('handles an account with nothing connected yet', () => {
    // The App install is step zero, so the brief has to read sensibly before
    // there is a single repo to name.
    const text = accountSetupPrompt(input({ repos: [] }));
    expect(text).toContain('(0)');
    expect(text).toContain('none connected yet');
  });

  it('asks for a key when none was minted, and never invents one', () => {
    const text = accountSetupPrompt(input());
    expect(text).toContain('Ask me for a lurq API key');
    expect(text).not.toContain('LURQ_API_KEY (live credential');
  });

  it('carries a minted key and says plainly that it is live', () => {
    const text = accountSetupPrompt(input({ apiKey: 'EXAMPLE-NOT-A-REAL-KEY' }));
    expect(text).toContain('EXAMPLE-NOT-A-REAL-KEY');
    expect(text).toMatch(/LIVE credential/);
    expect(text).toContain('https://www.lurq.run/dashboard/keys');
    expect(text).not.toContain('Ask me for a lurq API key');
  });

  it('keeps the secret out of shell history', () => {
    // `gh secret set` with no --repo, run from inside the checkout: gh resolves
    // the repository itself, and the value is read from stdin.
    const text = accountSetupPrompt(input({ apiKey: 'EXAMPLE-NOT-A-REAL-KEY' }));
    expect(text).toContain('gh secret set LURQ_API_KEY');
    expect(text).not.toContain('--body');
  });

  it('explains that the mode is read at run time', () => {
    // Otherwise an agent or a reader assumes the written file is the final
    // word, and the dashboard toggle looks broken again.
    expect(accountSetupPrompt(input())).toMatch(/reads the\s+mode from my dashboard/);
  });
});
