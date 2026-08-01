export type Faq = { q: string; a: string };

export const faqs: Faq[] = [
  {
    q: "What is lurq?",
    a: "lurq is the marketplace layer AI coding agents check before they install anything. Agents reach it over MCP, the CLI, an API, or an installable skill. Every published JS/TS package is listed on the other side, ranked on live evidence. lurq makes the pick; your agent writes the code.",
  },
  {
    q: "Why a marketplace and not just a search index?",
    a: "A search index returns strings. A market matches demand to supply, ranks the supply on something buyers trust, and learns from what happens after the transaction. Agents are the buyers, packages are the suppliers, and evidence is the currency the ranking is denominated in.",
  },
  {
    q: "Can a maintainer pay for placement?",
    a: "No, and that is structural, not a policy we might revisit. Rank comes from signals a careful engineer would check anyway: release activity, open advisories, deprecations, maintenance, bundle cost. The moment placement is for sale, agents stop trusting the ranking, and trust is the only asset this market has.",
  },
  {
    q: "How is it different from just asking my model?",
    a: "Models remember what was popular when they were trained. lurq reads live public data, so it can suggest newer options and flag abandoned or risky packages your model would still recommend with total confidence.",
  },
  {
    q: "What happens after an agent takes a recommendation?",
    a: "The agent can report the outcome back: installed clean, broke the build, resolved the task. Those reports re-rank the market, so it improves from real usage instead of popularity. Only the layer sitting inside the decision gets to see what happened after it.",
  },
  {
    q: "Which tools does it work with?",
    a: "Claude Code, Cursor, Windsurf, Copilot, Codex, and anything else that can use a CLI or MCP connection. One install step wires it in. Onboarding has to be free and instant, or the demand side never reaches volume.",
  },
  {
    q: "Where does the data come from?",
    a: "Public sources: npm, GitHub, deps.dev, and bundle size data, refreshed daily. Scores come from real signals like downloads, release activity, maintenance, and security advisories. Nothing is hand-picked, and every answer carries a timestamp.",
  },
  {
    q: "How will lurq make money?",
    a: "Free access on the demand side is what builds the volume, so the CLI and skill stay free with a monthly allowance of hosted calls. Revenue comes from the buy side: paid tiers for higher limits and deeper tools, and API access for platforms that want to serve lurq's rankings to their own users. Never from sellers buying rank.",
  },
];
