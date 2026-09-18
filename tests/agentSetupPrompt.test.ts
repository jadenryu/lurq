/**
 * The setup brief handed to a coding agent.
 *
 * Two properties are worth more than the wording, and both are about the prompt
 * not making things worse than the manual path it replaces: it must never carry
 * a credential, and it must never tell the agent to commit the file that grants
 * write access without showing the user first.
 */
import { describe, expect, it } from 'vitest';
import { agentSetupPrompt, type AgentSetupInput } from '../apps/web/src/lib/agent-setup';

const WORKFLOW = `name: lurq upgrade\npermissions:\n  contents: write\n  pull-requests: write\n`;

const input = (over: Partial<AgentSetupInput> = {}): AgentSetupInput => ({
  repoFullName: 'acme/web',
  workflowPath: '.github/workflows/lurq-upgrade.yml',
  workflow: WORKFLOW,
  mode: 'fix',
  keysUrl: 'https://www.lurq.run/dashboard/keys',
  ...over,
});

describe('agentSetupPrompt', () => {
  it('never embeds a key, and says so out loud', () => {
    // The prompt is pasted into chat logs and screenshots. There is no input
    // that could carry a key, and the instruction is to ASK rather than assume
    // one is lying around — which is also what stops an agent reusing another
    // project's key here.
    const text = agentSetupPrompt(input());
    expect(text).toContain('Ask me for a lurq API key');
    expect(text).toMatch(/never print it back|Never print it back/);
    expect(text).not.toMatch(/lurq_[A-Za-z0-9]/);
    expect(Object.keys(input())).not.toContain('apiKey');
  });

  it('sets the secret through stdin rather than an argument', () => {
    // `gh secret set NAME --body <value>` would put the key in shell history.
    const text = agentSetupPrompt(input());
    expect(text).toContain('gh secret set LURQ_API_KEY --repo acme/web');
    expect(text).not.toContain('--body');
  });

  it('tells the agent to stop before pushing', () => {
    // Committing the workflow is what grants write access to the repo. An agent
    // that pushes it has made that decision on the user's behalf.
    const text = agentSetupPrompt(input());
    expect(text).toMatch(/Show me the diff and stop/);
    expect(text).toMatch(/Do not push/);
  });

  it('forbids editing the permissions block', () => {
    // A helpful agent "tidying" the workflow is the realistic way this becomes
    // less safe than the copy-paste path it replaces.
    expect(agentSetupPrompt(input())).toMatch(/do not change the permissions block/i);
  });

  it('carries the rendered workflow verbatim', () => {
    // Per-repo: the file already has this repo's package manager and mode baked
    // in, which is why the prompt ships the YAML instead of telling the agent
    // to write one.
    const text = agentSetupPrompt(input());
    expect(text).toContain('name: lurq upgrade');
    expect(text).toContain('contents: write');
    expect(text.indexOf('.github/workflows/lurq-upgrade.yml ---')).toBeLessThan(
      text.indexOf('name: lurq upgrade'),
    );
  });

  it('asks for an Anthropic credential only in pr mode', () => {
    const pr = agentSetupPrompt(input({ mode: 'pr' }));
    expect(pr).toContain('CLAUDE_CODE_OAUTH_TOKEN');
    expect(pr).toContain('ANTHROPIC_API_KEY');

    for (const mode of ['fix', 'comment'] as const) {
      const text = agentSetupPrompt(input({ mode }));
      expect(text, mode).toContain('No Anthropic credential is needed');
      expect(text, mode).not.toContain('CLAUDE_CODE_OAUTH_TOKEN');
    }
  });

  it('warns about the one-year expiry where the token is set', () => {
    // The trap: a scheduled job that works for a year and then stops. The
    // warning has to be at the moment the agent sets the secret, not in a doc
    // nobody reads twelve months later.
    const pr = agentSetupPrompt(input({ mode: 'pr' }));
    expect(pr).toMatch(/EXPIRES ONE YEAR/);
    // Case-insensitive on the first letter only: the contrast sits at the start
    // of its own clause ("Does not expire, bills per token"), and pinning the
    // capital would make this fail on a reworded sentence that still says it.
    expect(pr).toMatch(/[Dd]oes not expire/);
  });

  it('explains the failure that looks like a lurq bug', () => {
    // pr mode with no credential analyses correctly, then fails the job. An
    // agent that knows this tells the user; one that does not files an issue.
    expect(agentSetupPrompt(input({ mode: 'pr' }))).toMatch(/looks like a lurq bug and is not/);
  });

  it('names the repo everywhere it matters, for a multi-repo shell', () => {
    const text = agentSetupPrompt(input({ repoFullName: 'acme/api' }));
    expect(text).toContain('--repo acme/api');
    expect(text).not.toContain('acme/web');
  });
});
