/**
 * The last snapshot of each server, kept on this machine.
 *
 * "What changed since I last looked" should not require an account. The hosted
 * history is richer (every change point, across a team's machines), but a user
 * running the CLI with no key still deserves to hear that a tool's description
 * was rewritten overnight. One file per deployment, holding only the latest
 * snapshot — change points are the server's job.
 *
 * Snapshots are already scrubbed of credentials before they reach here; the
 * files are still written owner-only, because tool descriptions of a private
 * server are the user's business.
 */
import { createHash } from 'node:crypto';
import { chmodSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { lurqHome } from '../core/userConfig';
import type { Snapshot } from './snapshot';

export interface LocalSnapshot {
  version: 1;
  serverKey: string;
  configFingerprint: string;
  scannedAt: string;
  contentHash: string;
  snapshot: Snapshot;
}

const dir = () => join(lurqHome(), 'mcp-snapshots');

const fileFor = (serverKey: string, fingerprint: string) =>
  join(
    dir(),
    `${createHash('sha256').update(`${serverKey}#${fingerprint}`).digest('hex').slice(0, 32)}.json`,
  );

export function loadLocal(serverKey: string, fingerprint: string): LocalSnapshot | null {
  try {
    const parsed = JSON.parse(
      readFileSync(fileFor(serverKey, fingerprint), 'utf8'),
    ) as LocalSnapshot;
    // A file from a future format, or one a user hand-edited into nonsense, is
    // treated as absent: a wrong baseline would report changes that never happened.
    if (parsed?.version !== 1 || !Array.isArray(parsed.snapshot?.tools)) return null;
    return parsed;
  } catch {
    return null;
  }
}

/** Atomic replace: a scan killed mid-write must not leave a torn baseline. */
export function saveLocal(entry: LocalSnapshot): void {
  mkdirSync(dir(), { recursive: true, mode: 0o700 });
  const target = fileFor(entry.serverKey, entry.configFingerprint);
  const tmp = `${target}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify(entry), { mode: 0o600 });
  renameSync(tmp, target);
  try {
    chmodSync(target, 0o600);
  } catch {
    /* best effort on filesystems without POSIX modes */
  }
}
