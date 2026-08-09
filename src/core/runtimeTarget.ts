/**
 * Where a package is meant to run.
 *
 * The taxonomy has one `framework` category, so `framework` alone cannot tell
 * Express from React, and the diagram used to resolve that with a hand-written
 * set of six backend framework names. That set is wrong by construction: it
 * degrades every time the ecosystem ships a new server framework, and the
 * failure is silent — an unlisted one gets drawn in the Presentation layer as
 * though it rendered UI.
 *
 * This replaces the name list with a signal derived from each package's own
 * manifest, so a framework published tomorrow classifies correctly without
 * anyone editing lurq. The curated overrides remain, but as a correction layer
 * over a generalising classifier rather than as the whole mechanism — the same
 * shape as the curated-vs-learned successor map.
 *
 * Returns `null` rather than guessing. An unplaceable package belongs in the
 * diagram's explicit `Unclassified` bucket; inventing a layer for it is how a
 * reference architecture quietly becomes fiction.
 */

export type RuntimeTarget = 'browser' | 'node';

/**
 * Keywords that only make sense for something serving requests. Deliberately
 * excludes the genuinely ambiguous ones — `web`, `app`, `framework`, `json` —
 * which appear on both sides and would classify React as a server.
 */
const SERVER_KEYWORDS = new Set([
  'server',
  'http-server',
  'backend',
  'middleware',
  'rest',
  'restful',
  'api',
  'router',
  'routing',
  'orm',
  'database',
  'sql',
  'graphql-server',
  'microservice',
  'websocket',
  'rpc',
]);

/** Keywords that only make sense for something running in a document. */
const BROWSER_KEYWORDS = new Set([
  'react',
  'vue',
  'svelte',
  'angular',
  'preact',
  'solid',
  'dom',
  'browser',
  'component',
  'components',
  'ui',
  'css',
  'styling',
  'animation',
  'frontend',
  'client-side',
  'jsx',
  'hooks',
]);

/**
 * Peer dependencies that settle it: a package peering on a renderer is drawn by
 * that renderer, whatever its keywords claim.
 */
const RENDERER_PEERS = new Set(['react', 'react-dom', 'vue', 'svelte', '@angular/core', 'preact']);

/**
 * Packages whose manifests do not describe them well enough, corrected by hand.
 *
 * Kept small and treated as a correction, not a mechanism. Anything added here
 * is an admission that the classifier missed, so the list growing is a signal to
 * fix the rules above rather than to keep appending.
 */
const OVERRIDES: Record<string, RuntimeTarget> = {
  express: 'node',
  fastify: 'node',
  koa: 'node',
  hono: 'node',
  '@nestjs/core': 'node',
  '@hapi/hapi': 'node',
  // Meta-frameworks run in both places; they are the server in an architecture
  // diagram, which is the question this answers.
  next: 'node',
  nuxt: 'node',
  '@remix-run/node': 'node',
  astro: 'node',
};

export interface RuntimeTargetInput {
  name: string;
  /** The manifest declares a `browser` field — it ships a browser build. */
  hasBrowserField: boolean;
  keywords: string[];
  engines: Record<string, string> | null;
  peerDependencies: Record<string, string> | null;
}

export function classifyRuntimeTarget(input: RuntimeTargetInput): RuntimeTarget | null {
  const override = OVERRIDES[input.name.toLowerCase()];
  if (override) return override;

  // A renderer peer is the strongest signal available and outranks keywords: a
  // component library tagged `api` is still drawn by React.
  const peers = Object.keys(input.peerDependencies ?? {});
  if (peers.some((p) => RENDERER_PEERS.has(p))) return 'browser';

  const keywords = input.keywords.map((k) => k.toLowerCase());
  const server = keywords.filter((k) => SERVER_KEYWORDS.has(k)).length;
  const browser = keywords.filter((k) => BROWSER_KEYWORDS.has(k)).length;

  // A `browser` field is proof the package ships a browser build, but plenty of
  // isomorphic libraries ship one too — so it breaks ties rather than deciding.
  if (browser > server) return 'browser';
  if (server > browser) return 'node';
  if (input.hasBrowserField) return 'browser';

  // Last resort: declaring a node engine and nothing browser-shaped at all.
  // Weak on its own, which is why it runs only after everything else tied at zero.
  if (input.engines?.node && !input.hasBrowserField && browser === 0) return 'node';

  return null;
}
