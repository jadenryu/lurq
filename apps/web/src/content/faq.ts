export type Faq = { q: string; a: string };

export const faqs: Faq[] = [
  {
    q: "What is lurq?",
    a: "lurq is a live package index for AI coding tools. It helps your agent pick libraries that still work, and warn you about ones that will break the install, before anything lands in your project.",
  },
  {
    q: "How is it different from just asking my model?",
    a: "Models remember what was popular when they were trained. lurq looks at live public data, so it can suggest newer options and flag abandoned or risky packages your model may still recommend.",
  },
  {
    q: "Which tools does it work with?",
    a: "Claude Code, Cursor, Windsurf, Copilot, Codex, and anything else that can use a CLI or MCP connection. One install step wires it into your agent.",
  },
  {
    q: "Where does the data come from?",
    a: "Public sources: npm, GitHub, deps.dev, and bundle size data. Scores come from real signals like downloads, release activity, maintenance, and security advisories. Nothing is hand-picked.",
  },
  {
    q: "Is it free?",
    a: "Yes. Free while we are in pre-alpha. You can use the CLI, the agent connection, and the installable skill with a monthly allowance of hosted calls.",
  },
  {
    q: "How fresh is the data?",
    a: "We refresh daily. Every answer includes a timestamp so you know how current it is.",
  },
];
