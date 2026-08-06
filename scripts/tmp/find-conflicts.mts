import { createDb } from '../../src/db/client';
import { resolveArchitectureCompat, type CompatMember } from '../../src/compat/peerCompat';

const { sql, close } = createDb({ max: 2 });

// Top packages by downloads that actually declare peer deps or engines.
const rows = await sql`
  select name, latest_version, weekly_downloads, peer_dependencies, peer_dependencies_meta, engines, category
  from packages
  where weekly_downloads is not null
    and (peer_dependencies is not null or engines is not null)
  order by weekly_downloads desc
  limit 3400`;

console.log('candidates', rows.length);

const members: CompatMember[] = rows.map((r: any) => ({
  name: r.name,
  version: r.latest_version,
  peerDependencies: r.peer_dependencies,
  peerDependenciesMeta: r.peer_dependencies_meta,
  engines: r.engines,
}));

const byName = new Map(members.map((m) => [m.name, m]));
const dl = new Map(rows.map((r: any) => [r.name, Number(r.weekly_downloads)]));

// Pairwise
const found: { a: string; b: string; source: string; detail: string; score: number }[] = [];
for (let i = 0; i < members.length; i++) {
  for (let j = i + 1; j < members.length; j++) {
    const cs = resolveArchitectureCompat([members[i]!, members[j]!]);
    for (const c of cs) {
      const [a, b] = c.packages;
      if (!byName.has(a!) || !byName.has(b!)) continue;
      found.push({
        a: a!, b: b!, source: c.source, detail: c.detail,
        score: Math.min(dl.get(a!) ?? 0, dl.get(b!) ?? 0),
      });
    }
  }
}
found.sort((x, y) => y.score - x.score);
console.log('conflicts found:', found.length);
for (const f of found.slice(0, 60)) {
  console.log(`${f.score.toLocaleString().padStart(12)}  [${f.source}] ${f.detail}`);
}
await close();
