export type Faq = { q: string; a: string };

export const faqs: Faq[] = [
  {
    q: "What is lurq?",
    a: "lurq is a live index of JS/TS packages that your coding agent can check before it installs anything. It scores packages from public signals, and where it matters it goes further: installing them in a clean sandbox to see whether they actually work. Your agent asks lurq, then writes the code.",
  },
  {
    q: "How is it different from just asking my model?",
    a: "Models remember what was popular when they were trained. lurq reads live public data, so it can suggest newer options and flag abandoned or risky packages your model would still recommend with total confidence.",
  },
  {
    q: "What do you mean by execution-verified?",
    a: "Most of what you can know about a package comes from reading metadata: downloads, release dates, advisories. Some things you can only learn by running it. lurq installs packages in an isolated sandbox and records what happened — did the install succeed, does it import, do these two versions coexist. Those facts appear in no changelog and no model's training data.",
  },
  {
    q: "Why does a whole stack need checking, not just each package?",
    a: "Because six individually healthy packages can still refuse to install together. Peer ranges conflict, engines disagree, transitive versions collide. lurq mines compatibility from real co-installs, so `plan` can tell you the set holds together rather than just that each piece looks fine alone.",
  },
  {
    q: "Which tools does it work with?",
    a: "Claude Code, Cursor, Windsurf, Copilot, Codex, and anything else that can use a CLI or MCP connection. One install step wires it into your agent.",
  },
  {
    q: "Where does the data come from?",
    a: "Public sources for the signals: npm, GitHub, deps.dev, and bundle size data, refreshed daily. Everything else comes from our own sandbox runs. Scores are computed from real signals, never hand-picked, and the exact weights are public — run `lurq weights` to print them.",
  },
  {
    q: "How current is it?",
    a: "The index refreshes daily, and every answer carries a dataAsOf timestamp so you know how fresh it is. Where an answer comes from a sandbox run rather than metadata, it carries the evidence too.",
  },
  {
    q: "Is it free?",
    a: "Yes, free to get started. Create an account, generate an API key, and you get the CLI, the agent connection, and the installable skill with a monthly allowance of hosted calls.",
  },
];
