import { createDb } from '../../src/db/client';
const { sql, close } = createDb({ max: 2 });
const q = async (label: string, s: any) => {
  const r = await s;
  console.log('###', label, JSON.stringify(r, null, 1).slice(0, 4000));
};
await q('counts', sql`select
  (select count(*) from packages) as packages,
  (select count(*) from packages where health_score is not null) as scored,
  (select count(distinct category) from packages where category is not null) as categories,
  (select count(*) from package_versions) as versions,
  (select count(*) from api_surfaces) as api_surfaces,
  (select count(*) from compat_edges) as compat_edges,
  (select max(data_as_of) from packages) as data_as_of`);
await q('compat_by_prov', sql`select provenance, status, driver, count(*) from compat_edges group by 1,2,3 order by 4 desc`);
await q('api_surface_pkgs', sql`select package_name, count(*) n, array_agg(version order by version) v from api_surfaces group by 1 order by n desc limit 20`);
await q('categories', sql`select category, count(*) from packages where category is not null group by 1 order by 2 desc`);
await close();
