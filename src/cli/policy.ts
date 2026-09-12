/**
 * `lurq policy pull|push`: selection policy as a file in the repo.
 *
 * The point is review. A rule that refuses installs for a whole team should go
 * through a pull request like any other change to how the team builds, and a
 * dashboard form cannot be diffed. `push --check` is the PR gate; plain `push`
 * is the post-merge apply, and needs a policy:write key.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { resolveApiKey } from '../core/userConfig';
import { describeRules, diffPolicies } from '../policy/enforce';
import { validateSelectionPolicy } from '../policy/parse';
import type { SelectionPolicy } from '../policy/types';
import { getPolicy, putPolicy, type RemoteOptions } from './remote';

export async function runPolicyPull(file: string | undefined, opts: RemoteOptions): Promise<void> {
  const text = `${JSON.stringify(await getPolicy(opts), null, 2)}\n`;
  if (!file) {
    process.stdout.write(text);
    return;
  }
  writeFileSync(file, text);
  console.log(`wrote ${file}`);
}

/** The file as a policy, or null after printing what is wrong with it. */
export function readPolicyFile(file: string): SelectionPolicy | null {
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(file, 'utf8'));
  } catch (err) {
    console.error(`${file}: ${err instanceof Error ? err.message : String(err)}`);
    return null;
  }
  // Same validator the server runs, so --check can never pass a file push rejects.
  const result = validateSelectionPolicy(raw);
  if ('error' in result) {
    console.error(`${file}: ${result.error}`);
    return null;
  }
  return result.policy;
}

function indent(lines: string[], empty: string): string {
  return lines.length ? lines.map((line) => `  ${line}`).join('\n') : `  ${empty}`;
}

export async function runPolicyPush(
  file: string,
  opts: RemoteOptions & { check?: boolean },
): Promise<void> {
  const policy = readPolicyFile(file);
  if (!policy) {
    process.exitCode = 1;
    return;
  }

  if (opts.check) {
    console.log(`${file} is a valid policy.`);
    // With a key on hand, show the change merging this file would make: that is
    // what the person approving the PR is actually deciding. Without one (a
    // fork's PR has no secrets), validity is all that can honestly be said.
    if (!resolveApiKey(opts.apiKey)) {
      console.log(indent(describeRules(policy), 'no rules enforced.'));
      return;
    }
    console.log('pushing it would change:');
    console.log(indent(diffPolicies(await getPolicy(opts), policy), 'nothing.'));
    return;
  }

  const { previous } = await putPolicy(policy, opts);
  console.log('policy replaced.');
  console.log(
    previous
      ? indent(diffPolicies(previous, policy), 'no rule changes.')
      : indent(describeRules(policy), 'no rules enforced.'),
  );
}
