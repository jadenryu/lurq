import { defineConfig } from 'tsup';

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
    shims: true,
  },
]);
