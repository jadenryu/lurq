// Single source of truth for releases. Consumed by the /changelog page (full
// timeline) and the homepage ship-log terminal (recent teaser). Newest first.
export type Tag = "Added" | "Changed" | "Fixed";

export interface Entry {
  version: string;
  date: string;
  badge?: string;
  // One-line release summary. Shown on the homepage release cards; the full
  // /changelog timeline ignores it and lists the changes directly.
  summary?: string;
  changes: { tag: Tag; text: string }[];
}

export const entries: Entry[] = [
  {
    version: "0.0.6",
    date: "July 14, 2026",
    badge: "Launch",
    summary:
      "Public launch: the pre-launch owner gate is lifted, so lurq is open to everyone. No owner key required.",
    changes: [
      { tag: "Changed", text: "The pre-launch owner gate is lifted. The CLI and MCP server no longer require LURQ_OWNER_KEY, so anyone can use lurq." },
    ],
  },
  {
    version: "0.0.5",
    date: "July 14, 2026",
    badge: "Alpha",
    summary:
      "Hotfix: the CLI no longer crashes on launch when the E2B sandbox dependency is present.",
    changes: [
      { tag: "Fixed", text: "The E2B sandbox driver is now loaded lazily, so `lurq` no longer crashes at startup on Node 22.x (require(esm) of chalk@5 via e2b). Only `verify` touches E2B, and only when it runs." },
    ],
  },
  {
    version: "0.0.4",
    date: "July 14, 2026",
    badge: "Alpha",
    summary:
      "Tentatively available: hosted mode is now horizontally scalable: Redis-backed rate limiting, self-serve API keys, and on-demand ingestion moved off the request path.",
    changes: [
      { tag: "Added", text: "Self-serve API key issuance via Clerk, so you can provision keys without operator involvement." },
      { tag: "Added", text: "Org identity threads through every tool call and stamps the discovery flywheel." },
      { tag: "Changed", text: "Rate limiting is now Redis-backed, so hosted mode scales horizontally across instances." },
      { tag: "Changed", text: "On-demand ingestion runs asynchronously off the request path. recommend/evaluate no longer block on package discovery." },
      { tag: "Changed", text: "Auth key lookups are cached and lastUsedAt writes throttled, cutting ~2 DB ops per request." },
    ],
  },
  {
    version: "0.0.3",
    date: "July 3, 2026",
    summary:
      "verify now runs in a throwaway VM, discovery got a quality bar, and search stopped mixing embeddings across providers.",
    changes: [
      { tag: "Added", text: "verify installs and smoke-loads packages inside an E2B VM, so untrusted install scripts run isolated from your machine." },
      { tag: "Fixed", text: "on-demand discoveries are only seeded into the index once they clear a quality bar." },
      { tag: "Fixed", text: "embeddings are tagged with their provider space and filtered on it, so search never compares vectors across providers." },
    ],
  },
  {
    version: "0.0.2",
    date: "June 24, 2026",
    summary:
      "Hosted mode landed: a one-command install wizard, API keys, and a smarter scoring/discovery engine.",
    changes: [
      { tag: "Added", text: "Hosted HTTP serve mode (serve-http) with API keys, so agents can connect without self-hosting a database." },
      { tag: "Added", text: "install: a guided wizard that connects lurq to your AI assistant against the hosted endpoint." },
      { tag: "Added", text: "Scoring and discovery upgrade: a quality axis, hybrid search, edit-tunable weights, and on-demand package discovery." },
      { tag: "Fixed", text: "Per-key rate limiter no longer crashes on IPv6 clients (ERR_ERL_KEY_GEN_IPV6)." },
      { tag: "Fixed", text: "serve-http boots cleanly when the pgvector extension already exists." },
    ],
  },
  {
    version: "0.0.1",
    date: "June 23, 2026",
    badge: "First release",
    summary:
      "The CLI, MCP server, scoring engine, and one-command IDE install all landed at once: the whole product, day one.",
    changes: [
      { tag: "Added", text: "First public release, published to npm as lurqrun (the CLI command stays lurq)." },
      { tag: "Added", text: "MCP server (serve) exposing recommend, evaluate, compare, verify, and diagram." },
      { tag: "Added", text: "CLI mirroring the MCP tools, runnable via npx with no global install." },
      { tag: "Added", text: "install-skill: registers lurq as an MCP server in Claude Code, Cursor, Windsurf, Copilot, and Codex." },
      { tag: "Added", text: "Scoring engine over npm, GitHub, and deps.dev signals with a daily sync." },
      { tag: "Fixed", text: "recommend category inference (date/time queries no longer match the linting rule first)." },
    ],
  },
  {
    version: "Pre-release",
    date: "June 2026",
    summary:
      "Groundwork before the public launch: the marketing site, the curated seed index, and semantic search.",
    changes: [
      { tag: "Added", text: "Marketing site: hero, IDE marquee, showcase, reviews, and FAQ." },
      { tag: "Added", text: "Curated seed index and pgvector-backed semantic search with a local embedding fallback." },
    ],
  },
];
