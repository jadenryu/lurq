/**
 * Landing-page copy that isn't generated data.
 *
 * Every factual claim in here is checkable against the repo or the database:
 * the assistant list and config paths come from `src/cli/installSkill.ts`, the
 * endpoint from `src/core/constants.ts`, the tool count from the nine
 * `registerTool` calls in `src/mcp/server.ts`.
 *
 * Two things this file must never say: that rankings respond to reported
 * outcomes (they don't, outcomes are captured and go nowhere near the score),
 * and that any compatibility edge has been verified by installing anything (no
 * pair on this page has been co-installed; every edge is declared metadata).
 */

export const INSTALL_COMMAND = "npx lurqrun";
export const MCP_ENDPOINT = "https://api.lurq.run/mcp";
export const HEALTH_ENDPOINT = "https://api.lurq.run/healthz";
export const REPO_URL = "https://github.com/jadenryu/lurq";
export const NPM_URL = "https://www.npmjs.com/package/lurqrun";

/** The nine tools registered in src/mcp/server.ts. */
export const MCP_TOOLS = [
  "recommend",
  "evaluate",
  "compare",
  "compat",
  "verify",
  "usage",
  "diagram",
  "plan",
  "report_outcome",
] as const;

/** Assistants the installer writes config for, with the file it actually edits. */
export const ASSISTANTS = [
  {
    id: "claude-code",
    label: "Claude Code",
    logo: "/logos/claude-code.svg",
    path: "~/.claude.json",
  },
  {
    id: "cursor",
    label: "Cursor",
    logo: "/logos/cursor.svg",
    path: "~/.cursor/mcp.json",
  },
  {
    id: "windsurf",
    label: "Windsurf",
    logo: "/logos/windsurf.svg",
    path: "~/.codeium/windsurf/mcp_config.json",
  },
  {
    id: "copilot",
    label: "Copilot",
    logo: "/logos/github-copilot.svg",
    path: "~/Library/Application Support/Code/User/mcp.json",
  },
  {
    id: "codex",
    label: "Codex",
    logo: "/logos/codex.svg",
    path: "~/.codex/config.toml",
  },
] as const;

export type Assistant = (typeof ASSISTANTS)[number];

/** Logos folded into the install band as one quiet row. */
export const EDITOR_LOGOS = [
  { name: "Claude Code", logo: "/logos/claude-code.svg" },
  { name: "Cursor", logo: "/logos/cursor.svg" },
  { name: "Windsurf", logo: "/logos/windsurf.svg" },
  { name: "GitHub Copilot", logo: "/logos/github-copilot.svg" },
  { name: "VS Code", logo: "/logos/vscode.svg" },
  { name: "Codex", logo: "/logos/codex.svg" },
] as const;

/**
 * What we don't do yet (§18). Same visual weight as everything else, this is
 * what makes the rest of the page believable, so it isn't softened and it isn't
 * styled as a roadmap tease.
 */
export const LIMITS: { title: string; body: string }[] = [
  {
    title: "nothing here has been co-installed",
    body: "Every compatibility edge on this page is solved from declared peer ranges and engine fields. The sandbox that would install a pair and run it exists in the repo but is not running at scale, so no edge is labelled verified. When it runs, these same edges move up a rung and the third legend colour starts earning its place.",
  },
  {
    title: "reported outcomes are captured, and go nowhere near the ranking",
    body: "Agents can report back whether a package worked. Those reports are stored and nothing reads them at ranking time. That is deliberate: at our size someone could write a few hundred fake reports in an afternoon, and placement is not for sale.",
  },
  {
    title: "the API-surface index is thin",
    body: "Types are parsed from the shipped .d.ts, which means we can only answer for versions we have parsed, and only for packages that ship a resolvable declaration file. Ask about a version we haven't read and the tool says so instead of guessing.",
  },
  {
    title: "npm and JS/TS only",
    body: "One ecosystem, one language family. No PyPI, no crates, no Maven, and no plans to fake breadth we don't have.",
  },
  {
    title: "untested pairs are shown as untested",
    body: "An empty result means we have no evidence, not that a combination is fine. The page renders the gap rather than filling it in.",
  },
];

export type Faq = { q: string; a: string };

/**
 * Audited against §18: the two answers that used to describe outcome-based
 * re-ranking and paid tiers are gone, because neither exists.
 */
export const FAQS: Faq[] = [
  {
    q: "What is lurq?",
    a: "An MCP server, a CLI, and an installable skill that sit in front of your coding agent's dependency decisions. Nine tools: check whether a set of packages holds together, read a version's real exported API, confirm a package name is not a typosquat, look at the evidence behind one package. Every answer carries a timestamp and the source it came from.",
  },
  {
    q: "How is this different from just asking the model?",
    a: "A model answers from text written before its cutoff. When a library ships a breaking major, every one of those texts is wrong and the model has no way to know, it writes clean, confident, non-existent code. lurq reads the package's own metadata and its shipped type declarations, so the answer moves when the package moves.",
  },
  {
    q: "What does 'declared' mean on the graph?",
    a: "That the finding comes from the packages' own metadata (peer-dependency ranges and engine fields, solved with semver) and not from installing anything. It is deterministic and it is instant, and it is also strictly weaker than running the install. We label it declared everywhere so the difference stays visible.",
  },
  {
    q: "So you haven't actually installed these together?",
    a: "No. Not one pair on this page has been co-installed. Two packages can agree in their metadata and still break at runtime, and we would only know that by running it. Until the sandbox runs at scale, every edge stays labelled declared.",
  },
  {
    q: "Can a maintainer pay for placement?",
    a: "No, and it is structural rather than a policy we might revisit. The score is computed from public signals (release activity, open advisories, deprecation, maintenance, install size) by code you can read in the repo. There is no ad slot, no sponsored result, and no field in the schema for one.",
  },
  {
    q: "Do reported outcomes change the ranking?",
    a: "No. An agent can report whether a package worked out, and those reports are stored, but nothing reads them when a score is computed. Anyone could write a few hundred fake reports in an afternoon at our current size.",
  },
  {
    q: "Which tools does it work with?",
    a: "One command writes MCP config for Claude Code, Cursor, Windsurf, VS Code / Copilot, and the Codex CLI, it edits the config file each one already reads. Anything else that speaks MCP can point at the hosted endpoint directly, and the CLI works on its own in any terminal.",
  },
  {
    q: "What if a package isn't in the index?",
    a: "The safety check always hits the live npm registry, so a name we have never seen still gets a real answer, that is the point of it, since hallucinated package names are new by definition. Deeper reads fetch and score on demand, then keep the package in the daily sync.",
  },
  {
    q: "Is it free?",
    a: "Yes, today. The CLI and the hosted server are free, the source is MIT licensed, and there is no paid tier to buy. How this eventually pays for itself is not decided; whatever the answer turns out to be, it will not be sellers buying rank.",
  },
];
