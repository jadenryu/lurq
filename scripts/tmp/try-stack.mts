import { createDb } from '../../src/db/client';
import { resolveArchitectureCompat, type CompatMember } from '../../src/compat/peerCompat';

const { sql, close } = createDb({ max: 2 });
const STACK = process.argv.slice(2);
const rows = await sql`
  select name, latest_version, weekly_downloads, peer_dependencies, peer_dependencies_meta, engines, category, health_score
  from packages where name = any(${STACK})`;
const missing = STACK.filter((s) => !rows.some((r: any) => r.name === s));
if (missing.length) console.log('MISSING FROM DB:', missing.join(', '));
const members: CompatMember[] = rows.map((r: any) => ({
  name: r.name, version: r.latest_version,
  peerDependencies: r.peer_dependencies, peerDependenciesMeta: r.peer_dependencies_meta, engines: r.engines,
}));
console.log('\n-- members --');
for (const r of rows as any[]) console.log(`${r.name}@${r.latest_version}  ${Number(r.weekly_downloads).toLocaleString()}/wk  [${r.category}]`);
console.log('\n-- whole-set conflicts --');
for (const c of resolveArchitectureCompat(members)) console.log(`[${c.source}] ${c.detail}`);
console.log('\n-- pairwise conflicts --');
const seen = new Set<string>();
for (let i = 0; i < members.length; i++) for (let j = i + 1; j < members.length; j++) {
  for (const c of resolveArchitectureCompat([members[i]!, members[j]!])) {
    const k = c.detail; if (seen.has(k)) continue; seen.add(k);
    console.log(`[${c.source}] ${c.detail}`);
  }
}
// deps.dev observed edges within the set
const names = rows.map((r: any) => r.name);
const edges = await sql`select package_a, version_a, package_b, version_b, status, provenance, driver, witness_count
  from compat_edges where package_a = any(${names}) and package_b = any(${names})`;
console.log(`\n-- observed edges within set: ${edges.length} --`);
for (const e of (edges as any[]).slice(0, 40)) console.log(`${e.package_a}@${e.version_a} ~ ${e.package_b}@${e.version_b}  ${e.status}/${e.provenance}/${e.driver} w=${e.witness_count}`);
await close();
