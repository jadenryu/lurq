#!/usr/bin/env node
/**
 * Refuses `npm publish` unless it runs from a clean `main` that matches GitHub.
 *
 * npm publishes whatever is checked out. lurqrun 0.1.3, 0.1.4 and 0.1.5 all
 * went out from a stale local branch 145 commits behind main, because that is
 * what the terminal happened to be on. This runs first in prepublishOnly, so a
 * publish from anywhere else stops with the fix instead of shipping old code.
 *
 * It also means a version bump has to reach main through a PR before it can be
 * published: `npm version patch` on local main puts it ahead of origin/main.
 */
import { execFileSync } from 'node:child_process';

const git = (...args) => execFileSync('git', args, { encoding: 'utf8' }).trim();

function refuse(message) {
  console.error(`\n✖ npm publish refused: ${message}\n`);
  process.exit(1);
}

const branch = git('rev-parse', '--abbrev-ref', 'HEAD');
if (branch !== 'main') {
  refuse(`you are on "${branch}", not main. Run: git switch main && git pull`);
}

if (git('status', '--porcelain')) {
  refuse('there are uncommitted changes. Commit them through a PR, or stash them.');
}

git('fetch', '--quiet', 'origin', 'main');
const local = git('rev-parse', 'HEAD');
const remote = git('rev-parse', 'origin/main');
if (local !== remote) {
  refuse(
    `local main (${local.slice(0, 7)}) is not origin/main (${remote.slice(0, 7)}). ` +
      'Run git pull, and land any local commits (including version bumps) through a PR first.',
  );
}

console.log(`✓ publishing from main at ${local.slice(0, 7)}`);
