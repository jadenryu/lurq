export type Faq = { q: string; a: string };

export const faqs: Faq[] = [
  {
    q: "What is lurq?",
    a: "lurq is a continuously-updated, evidence-scored index of JS/TS frameworks and libraries, exposed to your coding agent as an MCP server, a CLI, and an installable skill. It recommends and explains packages; your agent writes the code.",
  },
  {
    q: "How is it different from just asking my model?",
    a: "Your model's knowledge is frozen at its training cutoff and biased toward whatever was popular then. lurq scores packages from live public signals, so it surfaces newer, healthier dependencies your model may never have seen, and flags risky or abandoned ones.",
  },
  {
    q: "Which agents and IDEs are supported?",
    a: "Anything that speaks MCP or runs a CLI - including Claude Code, Cursor, Windsurf, Copilot, and Codex. One command installs lurq into your agent's config.",
  },
  {
    q: "Where does the data come from?",
    a: "Public APIs: npm, GitHub, deps.dev, and bundlephobia. Scores are computed from real signals like downloads, release cadence, maintenance, and security advisories - never hand-written.",
  },
  {
    q: "Is the CLI free?",
    a: "Yes. The CLI and installable skill are free, with a monthly allowance of hosted calls. Pro and Enterprise raise the limits and add tools like compare and diagram.",
  },
  {
    q: "How fresh is the index?",
    a: "It re-syncs on a daily cadence, and every response carries a dataAsOf timestamp so you always know how current the answer is.",
  },
];
