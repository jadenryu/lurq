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
 * dependencies, and only the manifest inside the tarball leaves them out, along
 * with the small pure-JS dependencies tsup compiles into dist. A self-hoster who
 * runs `lurq serve` is told the exact install command, with versions
 * (core/selfHost.ts).
 *
 * Not optional peerDependencies, which look like the textbook answer: npm still
 * fetches every optional peer's registry metadata to check its range, and
 * stripe's alone made a cold install of a two-package tree take 11s instead of 1s.
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
// Self-host server stack, and what tsup compiles into dist (tsup.config.ts).
const omitted = [...(pkg.lurq?.selfHostDependencies ?? []), ...(pkg.lurq?.inlinedDependencies ?? [])];

for (const name of omitted) {
  // A stale name means the list and the dependencies have drifted apart, and a
  // silent no-op would publish whatever the drift left behind.
  if (!pkg.dependencies?.[name]) {
    console.error(`✖ package.json "lurq" lists "${name}", which is not in dependencies.`);
    process.exit(1);
  }
  delete pkg.dependencies[name];
}

writeFileSync(BACKUP, raw);
writeFileSync(MANIFEST, JSON.stringify(pkg, null, 2) + '\n');
