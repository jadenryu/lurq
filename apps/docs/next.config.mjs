import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { createMDX } from 'fumadocs-mdx/next';

const __dirname = dirname(fileURLToPath(import.meta.url));

const withMDX = createMDX();

/** @type {import('next').NextConfig} */
const config = {
  reactStrictMode: true,
  // Served as a multi-zone secondary under apps/web at `/docs`. basePath puts
  // every route AND static asset under `/docs`, so the web app forwards the
  // whole prefix with a single rewrite pair.
  basePath: '/docs',
  // Pin the workspace root so output tracing ignores stray lockfiles outside the repo.
  turbopack: {
    root: resolve(__dirname, '../..'),
  },
};

export default withMDX(config);
