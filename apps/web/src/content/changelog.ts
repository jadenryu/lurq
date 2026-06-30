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
