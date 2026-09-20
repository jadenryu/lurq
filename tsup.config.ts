import { readFileSync } from 'node:fs';
import { defineConfig } from 'tsup';

// Pure-JS dependencies compiled into the public bundle instead of installed.
// Resolving them at install time is most of what a cold `npx lurqrun` spent
// its time on: the MCP SDK alone drags in 94 packages (express, hono, ajv…) for
// a client that is a few hundred kB once bundled. scripts/publish-manifest.mjs
// drops the same list from the published dependencies, so they are one list.
const INLINED: string[] = JSON.parse(readFileSync('package.json', 'utf8')).lurq.inlinedDependencies;
// The package itself and any subpath (`@modelcontextprotocol/sdk/client/index.js`).
const inlined = INLINED.map(
  (name) => new RegExp(`^${name.replace(/[/.]/g, (c) => `\\${c}`)}(/|$)`),
);

// Heavy CJS packages that MUST NOT be bundled into the ESM output: esbuild turns
// their internal `require("fs")` etc. into a shim that throws "Dynamic require of
// X is not supported" at runtime. Keep them external so Node loads the real
// installed package (whose dynamic requires work natively).
//
// `e2b` is reached only by the sandbox (§4C), an operator path, so a
// devDependency covers it. `typescript` used to be operator-only too, and this
// comment used to say so. It stopped being true when `check-upgrade` joined the
// public CLI: its reference scanner imports the compiler, esbuild hoists that
// static import to the top of the unsplit public bundle, and a public install
// (which gets no devDependencies) then died at boot with ERR_MODULE_NOT_FOUND on
// EVERY command. `typescript` is therefore a real runtime dependency now.
const NO_BUNDLE = ['typescript', 'e2b'];

// Two build targets (§4E operator/public plane split):
//  - Public: the `lurq` bin → `dist` (PUBLISHED). There used to be a library
//    entry beside it (dist/index.js), but package.json never declared `main` or
//    `exports`, so nothing could import it: it only doubled the tarball.
//  - Operator: the dataset-building bin → `dist-operator` (NOT published; the
//    `files: ["dist"]` whitelist excludes it, so ingestion code never ships).
export default defineConfig([
  {
    name: 'public',
    entry: {
      'bin/lurq': 'src/bin/lurq.ts',
    },
    format: ['esm'],
    target: 'node20',
    platform: 'node',
    outDir: 'dist',
    clean: true,
    // No sourcemaps in the published package: they were 4.7 MB of an 8.8 MB
    // install, downloaded by every `npx lurqrun` and read by nobody.
    sourcemap: false,
    // Split for the same reason as the operator target below, and for install
    // size too. Only the commands a user runs load their externals, so the
    // self-host server stack (express, postgres, drizzle-orm, stripe, ioredis…)
    // can be left out of the published dependencies entirely: `lurq verify`
    // never resolves it, and `lurq serve-http` names what to install
    // (core/selfHost.ts, scripts/publish-manifest.mjs).
    splitting: true,
    external: NO_BUNDLE,
    noExternal: inlined,
    // Bundled CommonJS (cross-spawn, ajv…) calls `require("child_process")`,
    // which esbuild's ESM output can only honour when a real `require` exists
    // in scope; without one it throws "Dynamic require of X is not supported".
    banner: {
      js: "import { createRequire as __lurqCreateRequire } from 'node:module'; const require = __lurqCreateRequire(import.meta.url);",
    },
    // Preserves the `#!/usr/bin/env node` shebang on the bin entry.
    shims: true,
  },
  {
    name: 'operator',
    entry: { 'bin/operator': 'src/bin/operator.ts' },
    format: ['esm'],
    target: 'node20',
    platform: 'node',
    outDir: 'dist-operator',
    clean: true,
    sourcemap: true,
    // Splitting is load-bearing here, not a size optimization. With one flat
    // bundle, esbuild hoists every external to the top of bin/operator.js — so
    // the four `import ts from "typescript"` statements inside the surface
    // extractors ran at BOOT, and a runtime without typescript (a prod install
    // that omits devDependencies) failed every operator command with
    // ERR_MODULE_NOT_FOUND, `db migrate` included. Splitting keeps the
    // dynamically-imported extractors in their own chunk, so typescript is
    // resolved only if surface extraction actually runs.
    splitting: true,
    external: NO_BUNDLE,
    shims: true,
  },
]);
