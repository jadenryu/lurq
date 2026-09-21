import { describe, expect, it } from 'vitest';
import {
  missingWorkflowScope,
  needsAgentCredential,
  parseRepoFromRemote,
} from '../src/cli/autopilotInit';

describe('parseRepoFromRemote', () => {
  it('reads the three remote shapes a real checkout has', () => {
    // Whichever of these a user cloned with, the command has to survive step one.
    for (const url of [
      'git@github.com:jadenryu/lurq.git',
      'git@github.com:jadenryu/lurq',
      'ssh://git@github.com/jadenryu/lurq.git',
      'https://github.com/jadenryu/lurq.git',
      'https://github.com/jadenryu/lurq',
      '  https://github.com/jadenryu/lurq.git\n',
    ]) {
      expect(parseRepoFromRemote(url), url).toBe('jadenryu/lurq');
    }
  });

  it('reads a self-hosted host, since the owner/name shape is what matters', () => {
    expect(parseRepoFromRemote('git@git.example.com:team/service.git')).toBe('team/service');
  });

  it('returns null rather than a guess when there is nothing to read', () => {
    // A wrong guess here sets a secret on someone else's repository, so the
    // failure mode has to be "ask", never "assume".
    for (const url of ['', '   ', 'not-a-url', 'https://github.com/only-owner']) {
      expect(parseRepoFromRemote(url), url).toBeNull();
    }
  });
});

describe('needsAgentCredential', () => {
  it('is true only for the mode that runs a model', () => {
    // `fix` opening pull requests with no credential is the whole point of the
    // default: claiming it needs a key would send every user to the console for
    // nothing, and missing one on `pr` fails the run at the credential check.
    expect(needsAgentCredential('pr')).toBe(true);
    expect(needsAgentCredential('fix')).toBe(false);
    expect(needsAgentCredential('comment')).toBe(false);
  });
});

describe('missingWorkflowScope', () => {
  it('flags a classic token without the workflow scope', () => {
    // Plain `gh auth login` grants exactly this, and GitHub answers a workflow
    // write without the scope with a 404 — the error every first run would hit.
    expect(missingWorkflowScope("  - Token scopes: 'gist', 'read:org', 'repo'")).toBe(true);
    expect(missingWorkflowScope("  - Token scopes: 'gist', 'repo', 'workflow'")).toBe(false);
  });

  it('does not guess when the status lists no scopes', () => {
    // Fine-grained tokens and GH_TOKEN print no scope line; the write itself will say.
    expect(missingWorkflowScope('✓ Logged in to github.com account someone (GH_TOKEN)')).toBe(
      false,
    );
  });
});
