// Interactive hero demo scenarios. Visitor clicks a need; demo shows the
// model's stale pick vs lurq's fresh resolution. Kept short: package + why,
// no dense evidence tables.

export type HeroScenario = {
  id: string;
  chip: string;
  query: string;
  stale: { pkg: string; reason: string };
  fresh: {
    tool: string;
    pkg: string;
    score: number;
    tag: string;
    verdict: string;
  };
};

export const heroScenarios: HeroScenario[] = [
  {
    id: "dates",
    chip: "date library",
    query: "what should I use for dates in a new TS project?",
    stale: {
      pkg: "moment",
      reason: "maintenance mode since 2020 · not tree-shakeable",
    },
    fresh: {
      tool: 'lurq recommend "date handling"',
      pkg: "date-fns",
      score: 94,
      tag: "high confidence",
      verdict: "actively maintained, tree-shakeable.",
    },
  },
  {
    id: "animation",
    chip: "react animation",
    query: "add a spring animation library to my React 19 app",
    stale: {
      pkg: "@react-spring/web@9",
      reason: "peer conflict with React 19, install fails",
    },
    fresh: {
      tool: 'lurq verify "@react-spring/web"',
      pkg: "@react-spring/web@10",
      score: 91,
      tag: "peer-compatible",
      verdict: "v10 clears the React 19 peer trap.",
    },
  },
  {
    id: "jwt",
    chip: "jwt auth",
    query: "sign and verify JWTs in my Node API",
    stale: {
      pkg: "jsonwebtoken@8",
      reason: "open security advisories",
    },
    fresh: {
      tool: 'lurq verify "jsonwebtoken@8"',
      pkg: "jose",
      score: 96,
      tag: "0 advisories",
      verdict: "modern, audited JWT library.",
    },
  },
  {
    id: "tailwind",
    chip: "tailwind setup",
    query: "set up the latest Tailwind in my Next.js app",
    stale: {
      pkg: "tailwind v3 config",
      reason: "stale v3 steps; v4 changed the setup",
    },
    fresh: {
      tool: 'lurq recommend "tailwind css setup"',
      pkg: "tailwindcss@4",
      score: 93,
      tag: "latest major",
      verdict: "CSS-first, no config file needed.",
    },
  },
];
