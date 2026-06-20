import { defineConfig } from 'tsup';

export default defineConfig({
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
});
