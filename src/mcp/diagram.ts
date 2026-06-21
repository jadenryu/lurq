/**
 * Optional `diagram` tool (§12.3.5). Emits a reference-architecture Mermaid
 * diagram for a stack the caller has *already chosen* (package names), using
 * built-in layer patterns. Input is stack-only by design: inferring an
 * architecture from a freeform description is the "architecture oracle" behavior
 * that the master spec (§4) and roadmap (§1) declare a non-goal. lurq labels a
 * stack you name; it does not design one. A starting point, not a validator.
 *
 * Honesty over completeness:
 * - A package we can't classify (not in the index AND no category match) is
 *   placed in an explicit `Unclassified` bucket — never silently dropped into a
 *   default layer. The note lists what couldn't be placed. Partial, not
 *   authoritative.
 * - KNOWN LIMITATION — front/back framework ambiguity: the taxonomy has a single
 *   `framework` category, so a `framework` package can't be told apart as
 *   frontend vs backend from its category alone. BACKEND_FRAMEWORKS is a
 *   hand-maintained band-aid that re-routes the common backend frameworks to the
 *   Backend layer; it degrades as the ecosystem adds new ones (an unlisted
 *   backend framework will be drawn in Presentation). The real fix is a taxonomy
 *   change (a distinct backend-framework category or a runtime/target flag on
 *   packages), which is out of scope for v1. Documented, not solved.
 */
import { inArray } from 'drizzle-orm';
import type { Category } from '../core/types';
import { inferCategory } from '../search/categoryInference';
import type { Database } from '../db/client';
import { packages } from '../db/schema';

/** Bucket for packages we cannot place: unknown category, or a category with no
 *  real architectural home (e.g. `other`). Rendered, but kept out of the flow. */
const UNCLASSIFIED = 'Unclassified';

/** Which architectural layer each category sits in. Categories with no honest
 *  architectural home (e.g. `other`) are intentionally absent: layerFor routes
 *  anything unmapped to UNCLASSIFIED rather than faking a layer. */
const LAYER_OF: Partial<Record<Category, string>> = {
  framework: 'Presentation',
  'meta-framework': 'Presentation',
  'ui-component-library': 'Presentation',
  styling: 'Presentation',
  animation: 'Presentation',
  charts: 'Presentation',
  'state-management': 'Client Logic',
  routing: 'Client Logic',
  forms: 'Client Logic',
  validation: 'Client Logic',
  'data-fetching': 'Client Logic',
  'http-client': 'Client Logic',
  i18n: 'Client Logic',
  'date-time': 'Client Logic',
  utility: 'Client Logic',
  auth: 'Backend',
  orm: 'Data',
  'database-client': 'Data',
  'build-tool': 'Tooling',
  bundler: 'Tooling',
  linting: 'Tooling',
  testing: 'Tooling',
};

const FLOW_LAYERS = ['Presentation', 'Client Logic', 'Backend', 'Data'];

/** Band-aid for the front/back framework ambiguity (see file header). Category
 *  `framework` alone can't distinguish frontend from backend, so these common
 *  backend frameworks are re-routed to the Backend layer. Hand-maintained;
 *  unlisted backend frameworks will be mis-drawn in Presentation. Not a real fix. */
const BACKEND_FRAMEWORKS = new Set([
  'express',
  'fastify',
  'koa',
  'hono',
  '@nestjs/core',
  '@hapi/hapi',
]);

interface Item {
  label: string;
  /** null = could not be classified (not in index, no category match). */
  category: Category | null;
}

function layerFor(item: Item): string {
  if (!item.category) return UNCLASSIFIED;
  if (item.category === 'framework' && BACKEND_FRAMEWORKS.has(item.label)) return 'Backend';
  return LAYER_OF[item.category] ?? UNCLASSIFIED;
}

function nodeId(label: string, i: number): string {
  return `n${i}_${label.replace(/[^a-zA-Z0-9]/g, '_')}`;
}

export function buildMermaid(items: Item[]): string {
  const byLayer = new Map<string, Item[]>();
  for (const item of items) {
    const layer = layerFor(item);
    const list = byLayer.get(layer) ?? [];
    list.push(item);
    byLayer.set(layer, list);
  }

  const lines = ['flowchart TD', '  user([User])'];
  const ids = new Map<string, string>(); // label → node id
  let counter = 0;
  const repNode = new Map<string, string>(); // layer → first node id

  const emitLayer = (layer: string) => {
    const list = byLayer.get(layer);
    if (!list?.length) return;
    lines.push(`  subgraph ${layer.replace(/\s+/g, '_')}["${layer}"]`);
    for (const item of list) {
      const id = nodeId(item.label, counter++);
      ids.set(item.label, id);
      if (!repNode.has(layer)) repNode.set(layer, id);
      // Unclassified nodes carry no category prefix — we don't claim one we lack.
      const text = layer === UNCLASSIFIED ? item.label : `${item.category}: ${item.label}`;
      lines.push(`    ${id}["${text}"]`);
    }
    lines.push('  end');
  };

  for (const layer of FLOW_LAYERS) emitLayer(layer);
  emitLayer('Tooling');
  emitLayer(UNCLASSIFIED);

  // Connect the flow layers that are present, top to bottom.
  const present = FLOW_LAYERS.filter((l) => byLayer.has(l));
  let prev = 'user';
  for (const layer of present) {
    lines.push(`  ${prev} --> ${repNode.get(layer)}`);
    prev = repNode.get(layer)!;
  }
  if (byLayer.has('Data')) lines.push(`  ${repNode.get('Data')} --> db[(Database)]`);

  return lines.join('\n');
}

export interface DiagramInput {
  stack?: string[];
}

export async function handleDiagram(
  db: Database,
  input: DiagramInput,
): Promise<{ mermaid: string; note: string }> {
  if (!input.stack?.length) {
    return {
      mermaid: 'flowchart TD\n  user([User]) --> app[Application]',
      note: 'Provide a `stack` of package names to diagram. lurq labels a stack you choose; it does not infer an architecture from a description.',
    };
  }

  const rows = await db
    .select({ name: packages.name, category: packages.category })
    .from(packages)
    .where(inArray(packages.name, input.stack));
  const known = new Map(rows.map((r) => [r.name, r.category]));
  // inferCategory is best-effort on a bare package name (it was built for NL
  // needs); a miss yields null, not a faked category. No silent 'other'.
  const items: Item[] = input.stack.map((name) => ({
    label: name,
    category: known.get(name) ?? inferCategory(name),
  }));

  const unclassified = items.filter((i) => layerFor(i) === UNCLASSIFIED).map((i) => i.label);
  const note = unclassified.length
    ? `Reference pattern derived from the provided stack — partial, not authoritative. Could not place ${unclassified.length} package(s): ${unclassified.join(', ')} (not in lurq's index and no category match) — shown under Unclassified, outside the flow.`
    : 'Reference pattern derived from the provided stack. A labeled starting point, not a validated architecture.';

  return { mermaid: buildMermaid(items), note };
}
