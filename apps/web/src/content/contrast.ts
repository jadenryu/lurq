// Side-by-side "Without lurq / With lurq" scenarios shown on the landing page.
//
// NOTE: the evidence numbers (downloads, scores, dates) below are illustrative
// placeholders. Swap them for real `lurq recommend` / MCP output before launch so
// the section stays accurate and verifiable.

export type ContrastCase = {
  id: string;
  /** short tab label */
  tab: string;
  /** the identical prompt sent in both columns */
  prompt: string;
  without: {
    /** what the agent reaches for from stale training data */
    pkg: string;
    /** the agent's (bad) reply, line by line */
    reply: string[];
    /** the problem lurq would have caught */
    flag: string;
  };
  with: {
    /** the lurq tool the agent invokes */
    toolCall: string;
    /** the recommended package */
    pkg: string;
    /** headline score / confidence */
    score: string;
    /** the agent's (good) reply, line by line */
    reply: string[];
    /** evidence rows rendered as a compact table */
    evidence: { label: string; value: string }[];
  };
};

export const contrastCases: ContrastCase[] = [
  {
    id: "deprecated",
    tab: "Deprecated library",
    prompt: "What should I use for date handling in a new TypeScript project?",
    without: {
      pkg: "moment",
      reply: [
        "Use Moment.js — it's the standard for dates in JS.",
        "npm install moment",
      ],
      flag: "Moment has been in maintenance mode since 2020 and ships a ~4.2MB, non-tree-shakeable bundle.",
    },
    with: {
      toolCall: 'lurq recommend "date handling"',
      pkg: "date-fns",
      score: "Health 94 · High confidence",
      reply: [
        "date-fns is the current best pick — modular, immutable,",
        "and fully tree-shakeable. (Temporal is the runtime-native",
        "successor once your target supports it.)",
        "npm install date-fns",
      ],
      evidence: [
        { label: "Weekly downloads", value: "21.4M" },
        { label: "Last publish", value: "3 weeks ago" },
        { label: "Maintenance", value: "Active" },
        { label: "Bundle (tree-shaken)", value: "~3 KB" },
      ],
    },
  },
  {
    id: "security",
    tab: "Security / CVE",
    prompt: "I need to sign and verify JWTs in my Node API.",
    without: {
      pkg: "jsonwebtoken@8",
      reply: [
        "Add jsonwebtoken — pin it to v8 for stability.",
        "npm install jsonwebtoken@8",
      ],
      flag: "v8 is affected by known advisories (algorithm confusion / weak key handling). The agent has no way to see them.",
    },
    with: {
      toolCall: 'lurq verify "jsonwebtoken@8"',
      pkg: "jose",
      score: "0 known advisories · High confidence",
      reply: [
        "jsonwebtoken@8 has open security advisories — avoid it.",
        "Use jose: modern, audited, and standards-compliant",
        "(JWS/JWE/JWT) with no outstanding CVEs.",
        "npm install jose",
      ],
      evidence: [
        { label: "Known advisories", value: "0" },
        { label: "Last publish", value: "11 days ago" },
        { label: "Maintenance", value: "Active" },
        { label: "Types", value: "Built-in" },
      ],
    },
  },
  {
    id: "stale",
    tab: "Stale version",
    prompt: "Set up the latest Tailwind CSS in my Next.js app.",
    without: {
      pkg: "tailwindcss (v3 setup)",
      reply: [
        "Create tailwind.config.js and add the content globs,",
        "then wire up postcss with the tailwindcss plugin.",
        "npx tailwindcss init -p",
      ],
      flag: "These are v3 instructions. Tailwind v4 dropped the JS config file and changed the PostCSS plugin — the steps no longer apply.",
    },
    with: {
      toolCall: 'lurq recommend "tailwind css setup"',
      pkg: "tailwindcss@4",
      score: "Latest major · High confidence",
      reply: [
        "Tailwind v4 is current — no config file needed.",
        "Install the v4 PostCSS plugin and import it in CSS:",
        'npm install tailwindcss @tailwindcss/postcss',
        '/* globals.css */ @import "tailwindcss";',
      ],
      evidence: [
        { label: "Latest version", value: "4.x" },
        { label: "Released", value: "Current major" },
        { label: "Setup", value: "CSS-first, no config" },
        { label: "Maintenance", value: "Active" },
      ],
    },
  },
];
