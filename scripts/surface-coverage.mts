/**
 * Ad-hoc coverage probe for §4D surface extraction: runs extractSurface over a
 * popular-library sample and reports how many yield a surface. Not part of the
 * test suite (it hits the network); run it by hand when changing extract.ts.
 *
 *   npx tsx scripts/surface-coverage.mts
 */
import { extractSurface } from '../src/usage/extract';

const SAMPLE = [
  'commander@12.1.0',
  'dotenv@16.4.5',
  'ioredis@5.4.1',
  'puppeteer@23.11.1',
  'axios@1.7.9',
  'zod@3.23.8',
  'drizzle-orm@0.44.2',
  'vite@6.3.5',
  'helmet@8.1.0',
  'execa@9.5.2',
  'ora@8.1.1',
  'react@18.3.1',
  'express@5.1.0',
  'semver@7.7.2',
];

let hit = 0;
for (const spec of SAMPLE) {
  const at = spec.lastIndexOf('@');
  const [name, version] = [spec.slice(0, at), spec.slice(at + 1)];
  const started = Date.now();
  const surface = await extractSurface(name, version).catch(() => null);
  const ms = Date.now() - started;
  if (surface) hit++;
  const sample = surface
    ? surface
        .slice(0, 6)
        .map((s) => s.name)
        .join(', ')
    : '';
  console.log(
    `${surface ? '  ok' : 'MISS'}  ${spec.padEnd(22)} ${String(surface?.length ?? 0).padStart(4)} symbols  ${String(ms).padStart(5)}ms  ${sample}`,
  );
}
console.log(`\n${hit}/${SAMPLE.length} extracted`);
