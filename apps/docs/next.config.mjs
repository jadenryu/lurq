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
  // /docs/<page>.md is that page as markdown (app/llms.mdx). basePath applies to
  // rewrites too, so this matches /docs/quickstart.md, not /quickstart.md.
  async rewrites() {
    return [{ source: '/:path*.md', destination: '/llms.mdx/:path*' }];
  },
  // Pin the workspace root so output tracing ignores stray lockfiles outside the repo.
  turbopack: {
    root: resolve(__dirname, '../..'),
  },
};

export default withMDX(config);
