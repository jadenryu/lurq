import { defineConfig } from 'tsup';

// Heavy CJS packages that MUST NOT be bundled into the ESM output: esbuild turns
// their internal `require("fs")` etc. into a shim that throws "Dynamic require of
// X is not supported" at runtime. Keep them external so Node loads the real
// installed package (whose dynamic requires work natively). `typescript` is only
// reached by operator-side extraction (§4D); `e2b` only by the sandbox (§4C) —
// both operator paths, present at runtime via devDependencies. The public plane
// imports neither, so externalizing here is a no-op for the published package.
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
    splitting: false,
    external: NO_BUNDLE,
    shims: true,
  },
]);
