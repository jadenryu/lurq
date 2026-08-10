/**
 * Recommendation quality harness.
 *
 * Ranking changes are the kind you can talk yourself into: any tweak looks
 * defensible in the diff and nobody can tell whether it helped. This runs a
 * fixed set of needs whose right answers are not in dispute, and prints
 * recall@5 plus the rank of the best expected hit, so a change is argued with a
 * number instead of an anecdote.
 *
 * The cases deliberately name SEVERAL acceptable answers each — the question is
 * never "is drizzle better than prisma", it is "did a real ORM appear at all,
 * or did a package with seventeen weekly downloads take the slot".
 *
 *   npx tsx scripts/eval-recommend.ts            # local index (DATABASE_URL)
 *   npx tsx scripts/eval-recommend.ts --hosted   # the live service
 */
import { recommend } from '../src/search/recommend';
import { createDb } from '../src/db/client';

interface Case {
  need: string;
  /** Any one of these in the top 5 counts as a hit. Substring match, so a
   *  scoped sibling (`@prisma/client`) satisfies `prisma`. */
  expect: string[];
}

const CASES: Case[] = [
  { need: 'an orm for postgres', expect: ['prisma', 'drizzle-orm', 'typeorm', 'kysely', 'sequelize', 'knex'] },
  { need: 'a date library', expect: ['date-fns', 'dayjs', 'luxon', 'temporal'] },
  { need: 'a form library for react', expect: ['react-hook-form', 'formik', 'react-final-form'] },
  { need: 'a ui component library for react', expect: ['@mui/material', 'antd', '@chakra-ui', 'react-aria', '@radix-ui', '@carbon/react'] },
  { need: 'a validation library for typescript', expect: ['zod', 'yup', 'joi', 'valibot', 'ajv', 'superstruct'] },
  { need: 'an http client', expect: ['axios', 'got', 'ky', 'node-fetch', 'undici'] },
  { need: 'a testing framework', expect: ['vitest', 'jest', 'mocha', 'ava', 'jasmine'] },
  { need: 'a state management library for react', expect: ['zustand', 'redux', 'jotai', 'mobx', 'recoil', 'valtio'] },
  { need: 'a bundler', expect: ['vite', 'esbuild', 'rollup', 'webpack', 'parcel', 'rspack'] },
  { need: 'a css in js styling library', expect: ['styled-components', 'emotion', 'tailwind', 'stitches', 'vanilla-extract'] },
];

function hitRank(names: string[], expect: string[]): number | null {
  for (let i = 0; i < names.length; i++) {
    const name = names[i]!.toLowerCase();
    if (expect.some((e) => name.includes(e.toLowerCase()))) return i + 1;
  }
  return null;
}

async function namesFor(need: string, hosted: boolean, db: unknown): Promise<string[]> {
  if (hosted) {
    const { callTool } = await import('../src/cli/remote');
    const res = await callTool<{ candidates?: { name: string }[] }>('recommend', { need });
    return (res.candidates ?? []).map((c) => c.name);
  }
  const candidates = await recommend(db as never, { need, limit: 5 });
  return candidates.map((c) => c.name);
}

async function main() {
  const hosted = process.argv.includes('--hosted');
  const handle = hosted ? null : createDb();
  let hits = 0;
  let rankSum = 0;

  console.log(`\nrecommend quality — ${hosted ? 'HOSTED' : 'local index'}\n`);
  try {
    for (const c of CASES) {
      const names = await namesFor(c.need, hosted, handle?.db);
      const rank = hitRank(names, c.expect);
      if (rank) {
        hits++;
        rankSum += rank;
      }
      const mark = rank ? `hit@${rank}` : 'MISS  ';
      console.log(`  ${mark}  ${c.need}`);
      console.log(`          ${names.join(', ') || '(none)'}`);
    }
  } finally {
    await handle?.close();
  }

  const pct = Math.round((hits / CASES.length) * 100);
  // Mean rank over hits only: a run that finds fewer answers but ranks them
  // first must not look better than one that finds more.
  const meanRank = hits ? (rankSum / hits).toFixed(2) : 'n/a';
  console.log(`\n  recall@5: ${hits}/${CASES.length} (${pct}%)   mean rank of first hit: ${meanRank}\n`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
