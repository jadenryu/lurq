/**
 * What the wizard tells you to type next.
 *
 * The failure this guards is a real one that shipped: setup ran from `npx`, the
 * user declined (or npm refused) the global install, and the summary still said
 * "`lurq recommend` … now work anywhere". Setup reported total success and the
 * very next thing the user typed was `command not found`.
 *
 * So the rule is: the printed invocation is decided by PATH, never by what the
 * wizard thinks it did.
 */
import { chmodSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { lurqInvocation } from '../src/cli/installSkill';
import { PACKAGE_NAME } from '../src/core/constants';

describe('lurqInvocation', () => {
  const savedPath = process.env.PATH;
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'lurq-path-'));
  });

  afterEach(() => {
    process.env.PATH = savedPath;
  });

  it('falls back to npx when nothing named lurq is on PATH', () => {
    process.env.PATH = dir;
    expect(lurqInvocation()).toEqual({ command: `npx ${PACKAGE_NAME}`, onPath: false });
  });

  it('uses the bare command once an executable lurq is on PATH', () => {
    const bin = join(dir, process.platform === 'win32' ? 'lurq.cmd' : 'lurq');
    writeFileSync(bin, '#!/bin/sh\necho 0.0.0\n');
    chmodSync(bin, 0o755);
    process.env.PATH = dir;
    expect(lurqInvocation()).toEqual({ command: 'lurq', onPath: true });
  });

  it('does not count a non-executable file as an installed command', () => {
    // A leftover `lurq` that cannot be run is exactly the case where claiming
    // the command exists is worse than falling back to npx.
    if (process.platform === 'win32') return; // POSIX permission bits only.
    const bin = join(dir, 'lurq');
    writeFileSync(bin, 'not a program');
    chmodSync(bin, 0o644);
    process.env.PATH = dir;
    expect(lurqInvocation().onPath).toBe(false);
  });

  it('searches every PATH entry, not just the first', () => {
    const other = mkdtempSync(join(tmpdir(), 'lurq-path2-'));
    const bin = join(other, process.platform === 'win32' ? 'lurq.cmd' : 'lurq');
    writeFileSync(bin, '#!/bin/sh\n');
    chmodSync(bin, 0o755);
    process.env.PATH = [dir, other].join(delimiter);
    expect(lurqInvocation().onPath).toBe(true);
  });

  it('survives an unset or empty PATH rather than throwing', () => {
    delete process.env.PATH;
    expect(lurqInvocation().onPath).toBe(false);
    process.env.PATH = '';
    expect(lurqInvocation().onPath).toBe(false);
  });
});
