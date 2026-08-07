/**
 * The four ways a person actually uses lurq, and the terminal output each one
 * produces.
 *
 * Every command here is a real subcommand in src/cli/index.ts and every path is
 * a route that src/mcp/http.ts actually serves. That rule is the whole point of
 * this file: the previous version of this section shipped a panel showing
 * `POST /recommend` with a JSON body, and no such endpoint has ever existed.
 * `serve-http` starts the MCP server over HTTP and serves `POST /mcp`.
 *
 * Nothing here prints a score, a version or a verdict. Those are claims about
 * what the index says on a given day, they belong to the recorded run in
 * content/agent-session.ts, and inventing them for a decorative terminal is how
 * a landing page starts lying. What these panels show is structure: the command
 * you type, and the shape of what comes back.
 *
 * Engine internals (index, hybrid search, cache) were tabs here once. They are
 * not ways in, and #sources and #tools already cover them.
 *
 * The word "agent" survives in exactly one string here, and it is machine
 * output: the installer really does print "restart your agent". See the rules at
 * the top of content/copy.ts. Rewriting quoted output to dodge a house style
 * rule is worse than spending the word once.
 */

/** How a line is coloured. `next` is the trailing instruction, not output. */
export type TerminalLineKind = "cmd" | "ok" | "note" | "out" | "next";

export interface TerminalLine {
  kind: TerminalLineKind;
  text: string;
}

export interface Surface {
  id: string;
  /** Sits in the rail. Short enough not to wrap at 320px. */
  name: string;
  /** One line, in the rail under the name. */
  blurb: string;
  /** Copied by the button under the panel. */
  command: string;
  /** Right of the panel's title bar. */
  chrome: string;
  /** Under the panel. Two sentences at most. */
  detail: string;
  lines: TerminalLine[];
}

export const SURFACES_LABEL = "How you use it";
export const SURFACES_HEAD = "Four ways in, and the same index behind them.";

export const SURFACES: Surface[] = [
  {
    id: "install",
    name: "Guided install",
    blurb: "One command finds what you already have.",
    command: "npx lurqrun install",
    chrome: "lurq · install",
    detail:
      "After lurq asks for your API key, we work out which assistants are installed on the machine and write a keyed entry for each. Nothing else about your setup changes, and you don't need any database credentials.",
    lines: [
      { kind: "cmd", text: "npx lurqrun install" },
      { kind: "ok", text: "key validated" },
      { kind: "ok", text: "detected Claude Code, Cursor, VS Code" },
      { kind: "ok", text: "wrote 3 keyed MCP entries" },
      { kind: "note", text: "no database credentials written" },
      { kind: "next", text: "restart your agent to finish" },
    ],
  },
  {
    id: "mcp",
    name: "MCP server",
    blurb: "The tools your editor gets.",
    command: "npx lurqrun install-skill --agent claude-code",
    chrome: "lurq · mcp",
    detail:
      "MCP is the standard way an editor hands a model a new tool. Register lurq once and everything in that editor can reach it.",
    lines: [
      { kind: "cmd", text: "npx lurqrun install-skill --agent claude-code" },
      { kind: "ok", text: "connected · https://api.lurq.run/mcp" },
      { kind: "out", text: "tools: recommend evaluate compare verify compat" },
      { kind: "out", text: "       plan diagram usage report_outcome" },
      { kind: "note", text: "every response carries a dataAsOf timestamp" },
    ],
  },
  {
    id: "cli",
    name: "Command line",
    blurb: "For nerds, run in your terminal.",
    command: "npm i -g lurqrun",
    chrome: "lurq · cli",
    detail:
      "Every capability is a subcommand, so the check that settles a question mid-task can prevent a bad CI job on the way out.",
    lines: [
      { kind: "cmd", text: "lurq verify jsonwebtoken" },
      { kind: "cmd", text: "lurq compare date-fns dayjs moment" },
      { kind: "cmd", text: "lurq compat next react react-dom" },
      { kind: "cmd", text: "lurq usage zod --known 3.22.4" },
      { kind: "note", text: "--json on any of them, for a script to read" },
    ],
  },
  {
    id: "api",
    name: "Self-hosted endpoint",
    blurb: "Run the server behind your personal key.",
    command: "lurq serve-http",
    chrome: "lurq · serve-http",
    detail:
      "The same MCP server over HTTP, with API-key auth and rate limits. For a platform that needs the endpoint inside its own perimeter.",
    lines: [
      { kind: "cmd", text: "lurq serve-http --port 8080" },
      { kind: "ok", text: "listening on :8080" },
      { kind: "out", text: "POST /mcp     api key required" },
      { kind: "out", text: "GET  /healthz" },
      { kind: "note", text: "per-ip and per-key rate limits on by default" },
    ],
  },
];
