// ─────────────────────────────────────────────────────────────────────────
// ILLUSTRATIVE BENCHMARK DATA (marketing placeholders).
// Layout target: Nia-style vertical bars + Key Metrics + methodology panel.
// Replace values with published bakeoff numbers when ready.
// ─────────────────────────────────────────────────────────────────────────

export type ChartBar = {
  id: string;
  label: string;
  value: number;
  kind: "lurq" | "baseline";
};

export const benchmark = {
  eyebrow: "proof",
  heading: "fewer broken installs when agents use lurq.",
  sub: "Early numbers from our internal tests. Direction is clear: lurq helps agents avoid packages that will not install cleanly.",

  metrics: [
    { value: "#1", label: "Fewest broken stacks in our suite" },
    { value: "2.4×", label: "Fewer bad installs vs the agent alone" },
    { value: "+18 pts", label: "Better install success with Claude + lurq" },
  ],

  chart: {
    title: "Broken-stack rate · our test suite",
    dataset: "Conflicts · outdated packages · engine mismatches · clean cases",
    hint: "lower is better · illustrative",
    bars: [
      { id: "lurq", label: "Claude + lurq", value: 12, kind: "lurq" },
      { id: "gemini", label: "Gemini alone", value: 24, kind: "baseline" },
      { id: "gpt", label: "GPT alone", value: 28, kind: "baseline" },
      { id: "claude", label: "Claude alone", value: 31, kind: "baseline" },
      { id: "web", label: "web search only", value: 39, kind: "baseline" },
      { id: "none", label: "no tooling", value: 47, kind: "baseline" },
    ] as ChartBar[],
  },

  methodology: {
    bullets: [
      "We tested real failure cases: missing packages, outdated libraries, React conflicts, Node mismatches, plus clean controls.",
      "Same prompts with and without lurq across GPT, Claude, and Gemini.",
      "A pass means the stack installs, or was correctly flagged as should fail.",
      "Numbers here are illustrative until we publish the full suite.",
    ],
    categories: [
      "missing package",
      "outdated",
      "peer conflict",
      "engine mismatch",
    ],
  },

  note: "Illustrative only. Catching bad installs is the strongest result so far. Swap numbers in content/benchmark.ts before making external claims.",
} as const;
