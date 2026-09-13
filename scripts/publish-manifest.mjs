#!/usr/bin/env node
/**
 * Slim the published manifest: `prepack` strips, `postpack` restores.
 *
 * This repository is two things with one package.json. It is the `lurqrun` CLI
 * people `npx`, and it is the hosted service Railway builds from this checkout
 * (`lurq serve-http`, the operator crons). The service needs express, postgres,
 * drizzle-orm, stripe, ioredis… as real dependencies. A person running
 * `npx lurqrun verify zod` needs none of them, yet used to download all of them:
 * 161 packages and 98 MB before the first line of output.
 *
 * Moving them to devDependencies would fix the tarball and bet production on
 * the builder never pruning dev dependencies. Instead the repo keeps them as
 * dependencies, and only the manifest inside the tarball lists them as optional
 * peerDependencies: not installed by default, still versioned for a self-hoster
 * who adds them (`lurq serve` names the exact install command, core/selfHost.ts).
 *
 * npm re-reads package.json after `prepack`, so `npm pack` and `npm publish`
 * both ship the stripped copy, and `postpack` puts the original back.
 *
 *   node scripts/publish-manifest.mjs strip | restore
 */
import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';

const MANIFEST = 'package.json';
const BACKUP = 'package.json.prepack-backup';

const mode = process.argv[2];

if (mode === 'restore') {
  if (existsSync(BACKUP)) renameSync(BACKUP, MANIFEST);
  process.exit(0);
}

if (mode !== 'strip') {
  console.error('usage: publish-manifest.mjs strip | restore');
  process.exit(2);
}

// A backup left behind means an earlier pack died between the two hooks, and
// package.json is the stripped copy. Stripping again would back up the stripped
// copy over the real one and lose the server dependencies for good.
if (existsSync(BACKUP)) {
  console.error(
    `✖ ${BACKUP} exists: a previous pack did not finish. Run \`node scripts/publish-manifest.mjs restore\` first.`,
  );
  process.exit(1);
}

const raw = readFileSync(MANIFEST, 'utf8');
const pkg = JSON.parse(raw);
const selfHost = pkg.lurq?.selfHostDependencies ?? [];

pkg.peerDependencies ??= {};
pkg.peerDependenciesMeta ??= {};
for (const name of selfHost) {
  const range = pkg.dependencies?.[name];
  if (!range) {
    console.error(`✖ lurq.selfHostDependencies lists "${name}", which is not in dependencies.`);
    process.exit(1);
  }
  delete pkg.dependencies[name];
  pkg.peerDependencies[name] = range;
  pkg.peerDependenciesMeta[name] = { optional: true };
}

writeFileSync(BACKUP, raw);
writeFileSync(MANIFEST, JSON.stringify(pkg, null, 2) + '\n');
