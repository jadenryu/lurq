/**
 * `lurq policy pull|push`: selection policy as a file in the repo.
 *
 * The point is review. A rule that refuses installs for a whole team should go
 * through a pull request like any other change to how the team builds, and a
 * dashboard form cannot be diffed. `push --check` is the PR gate; plain `push`
 * is the post-merge apply, and needs a policy:write key.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { describeRules } from '../policy/enforce';
import { parseSelectionPolicy } from '../policy/parse';
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

/** The file as a policy, or null after printing why not. */
export function readPolicyFile(file: string): SelectionPolicy | null {
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(file, 'utf8'));
  } catch (err) {
    console.error(`${file}: ${err instanceof Error ? err.message : String(err)}`);
    return null;
  }
  // Same parser the server runs, so --check can never pass a file push rejects.
  const policy = parseSelectionPolicy(raw);
  if (!policy) {
    console.error(
      `${file} is not a valid policy. Start from \`lurq policy pull\` output; every field it writes is required.`,
    );
  }
  return policy;
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
  const saved = opts.check ? policy : await putPolicy(policy, opts);
  const rules = describeRules(saved);
  console.log(opts.check ? `${file} is a valid policy.` : 'policy replaced.');
  console.log(rules.length ? rules.map((r) => `  ${r}`).join('\n') : '  no rules enforced.');
}
