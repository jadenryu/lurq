/**
 * Optional `diagram` tool (§12.3.5). Emits a reference-architecture Mermaid
 * diagram from the packages/categories provided, using built-in layer patterns.
 * Deliberately NOT an architecture oracle — a labeled starting point only.
 */
import { inArray } from 'drizzle-orm';
import type { Category } from '../core/types';
import { inferCategories, inferCategory } from '../search/categoryInference';
import type { Database } from '../db/client';
import { packages } from '../db/schema';

/** Which architectural layer each category sits in. */
const LAYER_OF: Record<Category, string> = {
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
  other: 'Client Logic',
};

const FLOW_LAYERS = ['Presentation', 'Client Logic', 'Backend', 'Data'];

/** Backend frameworks share category `framework` with frontend ones; route these
 *  to the Backend layer so the diagram flow reads correctly. */
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
  category: Category;
}

function layerFor(item: Item): string {
  if (item.category === 'framework' && BACKEND_FRAMEWORKS.has(item.label)) return 'Backend';
  return LAYER_OF[item.category] ?? 'Client Logic';
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
      lines.push(`    ${id}["${item.category}: ${item.label}"]`);
    }
    lines.push('  end');
  };

  for (const layer of FLOW_LAYERS) emitLayer(layer);
  emitLayer('Tooling');

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
  description?: string;
}

export async function handleDiagram(
  db: Database,
  input: DiagramInput,
): Promise<{ mermaid: string; note: string }> {
  let items: Item[] = [];
  let source = 'description';

  if (input.stack?.length) {
    source = 'packages';
    const rows = await db
      .select({ name: packages.name, category: packages.category })
      .from(packages)
      .where(inArray(packages.name, input.stack));
    const known = new Map(rows.map((r) => [r.name, r.category]));
    items = input.stack.map((name) => ({
      label: name,
      category: known.get(name) ?? inferCategory(name) ?? 'other',
    }));
  } else if (input.description) {
    const cats = inferCategories(input.description);
    items = cats.map((c) => ({ label: c, category: c }));
  }

  if (items.length === 0) {
    return {
      mermaid: 'flowchart TD\n  user([User]) --> app[Application]',
      note: 'Not enough signal to build a reference diagram — provide a `stack` of package names.',
    };
  }

  return {
    mermaid: buildMermaid(items),
    note: `Reference pattern derived from the provided ${source}. A starting point, not a validated architecture.`,
  };
}
