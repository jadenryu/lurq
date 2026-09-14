/**
 * Pinned: setup takes the link flow only where a person can open the link and
 * our dashboard can issue the key, and the agent's command returns as soon as
 * the detached copy prints the link.
 */
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import type { ChildProcess } from 'node:child_process';
import { describe, expect, it, vi } from 'vitest';
import { LINK_PREFIX, setupMode, startAgentLink } from '../src/cli/agentLink';

const base = { yes: false, tty: false, ci: false, hasKey: false, selfHosted: false };

describe('setupMode', () => {
  it('uses the wizard in a terminal and configures silently with --yes and a key', () => {
    expect(setupMode({ ...base, tty: true })).toBe('interactive');
    expect(setupMode({ ...base, tty: true, yes: true, hasKey: true })).toBe('non-interactive');
    expect(setupMode({ ...base, yes: true })).toBe('needs-key');
  });

  it('hands an agent shell a link when there is no key', () => {
    expect(setupMode(base)).toBe('agent-link');
  });

  it('never sends an agent that already has a key to sign in again', () => {
    expect(setupMode({ ...base, hasKey: true })).toBe('non-interactive');
  });

  it('refuses the link where nobody could use it: CI, or a self-hosted endpoint', () => {
    expect(setupMode({ ...base, ci: true })).toBe('needs-key');
    expect(setupMode({ ...base, selfHosted: true })).toBe('needs-key');
  });
});

function fakeChild() {
  const child = new EventEmitter() as ChildProcess & EventEmitter;
  const stdout = new PassThrough();
  Object.assign(child, { stdout, unref: vi.fn() });
  return { child, stdout };
}

describe('startAgentLink', () => {
  it('starts a detached copy with the internal flag and returns the link it prints', async () => {
    const { child, stdout } = fakeChild();
    const spawnImpl = vi.fn(() => child);
    const pending = startAgentLink({ agent: 'cursor', noOpen: true }, spawnImpl);

    stdout.write('some noise first\n');
    stdout.write(`${LINK_PREFIX}https://lurq.run/dashboard/cli?port=4567&nonce=abc\n`);

    await expect(pending).resolves.toBe('https://lurq.run/dashboard/cli?port=4567&nonce=abc');
    const [, args, options] = spawnImpl.mock.calls[0] as unknown as [string, string[], { detached: boolean }];
    expect(args).toEqual(expect.arrayContaining(['setup', '--wait-for-signin', '--agent', 'cursor', '--no-open']));
    expect(options.detached).toBe(true);
    expect(child.unref).toHaveBeenCalled();
  });

  it('returns null when the copy exits before printing a link', async () => {
    const { child } = fakeChild();
    const pending = startAgentLink({}, vi.fn(() => child));
    child.emit('exit', 1);
    await expect(pending).resolves.toBeNull();
  });
});
