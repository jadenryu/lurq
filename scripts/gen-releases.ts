/**
 * Every published version of the npm package, with the date the registry
 * stamped it.
 *
 *   npx tsx scripts/gen-releases.ts
 *
 * WHY THIS IS GENERATED AND NOT TYPED. A hand-maintained changelog is a file
 * that is correct on the day it is written and drifts from the registry on every
 * publish after that, silently, in the direction of claiming releases that did
 * not happen on the days it says. The registry knows exactly when each version
 * went out, so the dates come from there and cannot be wrong.
 *
 * WHAT THIS FILE DOES NOT CARRY. Release notes. The registry has no field for
 * them and inventing one here would put prose in a generated artifact, where the
 * next regeneration would silently delete it. Notes live in
 * apps/web/src/content/releases.ts, keyed by version, and the page joins the
 * two: dates from here, words from there. That is the same split
 * content/agent-session.ts draws between a recorded run and the sentences around
 * it.
 *
 * Fails loudly rather than writing a partial file. A changelog missing its most
 * recent release is worse than no changelog, because nobody looking at it can
 * tell.
 */
import { writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'apps/web/src/content/generated/releases.json');

const PACKAGE = 'lurqrun';
const REGISTRY = `https://registry.npmjs.org/${PACKAGE}`;

interface Packument {
  'dist-tags'?: Record<string, string>;
  /** version -> ISO date, plus the `created` and `modified` keys. */
  time?: Record<string, string>;
}

async function main(): Promise<void> {
  // The FULL packument, not the abbreviated one. `application/vnd.npm.install-v1+json`
  // is the right accept header for anything resolving a version to a tarball
  // and it is the wrong one here: the abbreviated document omits `time`
  // entirely, so the first version of this script asked for it and then failed
  // with "no published versions" against a package with eleven.
  const res = await fetch(REGISTRY);
  if (!res.ok) {
    throw new Error(`${REGISTRY} responded ${res.status} ${res.statusText}`);
  }

  const packument = (await res.json()) as Packument;
  const time = packument.time ?? {};
  const latest = packument['dist-tags']?.latest ?? null;

  // `created` and `modified` are not versions. They sit in the same map, which
  // is the one trap in this endpoint: including them yields a changelog with two
  // entries nobody published.
  const releases = Object.entries(time)
    .filter(([key]) => key !== 'created' && key !== 'modified')
    .map(([version, publishedAt]) => ({ version, publishedAt }))
    .sort((a, b) => Date.parse(b.publishedAt) - Date.parse(a.publishedAt));

  if (releases.length === 0) {
    throw new Error(`${PACKAGE} has no published versions in the registry response`);
  }

  await mkdir(path.dirname(OUT), { recursive: true });
  await writeFile(
    OUT,
    `${JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        source: `GET ${REGISTRY}`,
        package: PACKAGE,
        latest,
        releases,
      },
      null,
      2,
    )}\n`,
    'utf8',
  );

  console.log(`wrote ${releases.length} releases to ${path.relative(ROOT, OUT)}`);
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
