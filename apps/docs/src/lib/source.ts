import { docs } from '@/.source/server';
import { loader } from 'fumadocs-core/source';

export const source = loader({
  // basePath '/docs' (next.config.mjs) supplies the prefix; keep this '/' so
  // generated URLs aren't doubled to /docs/docs and active-link matching works
  // (Next's usePathname strips basePath).
  baseUrl: '/',
  source: docs.toFumadocsSource(),
});
