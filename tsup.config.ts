import { defineConfig } from 'tsup';

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
//  - Public: the read-only oracle bin + library entry → `dist` (PUBLISHED).
//  - Operator: the dataset-building bin → `dist-operator` (NOT published; the
//    `files: ["dist"]` whitelist excludes it, so ingestion code never ships).
export default defineConfig([
  {
    name: 'public',
    entry: {
      'bin/lurq': 'src/bin/lurq.ts',
      index: 'src/index.ts',
    },
    format: ['esm'],
    target: 'node20',
    platform: 'node',
    outDir: 'dist',
    clean: true,
    sourcemap: true,
    splitting: false,
    external: NO_BUNDLE,
    // Type declarations only for the library entry; the bin doesn't need them.
    dts: { entry: { index: 'src/index.ts' } },
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
