/**
 * Content for the in-dashboard "how to use lurq" guide.
 *
 * Every item here is transcribed from the live backend rather than written from
 * memory, so the guide can't drift into describing things lurq doesn't do:
 *
 *  - tools + inputs .......... src/mcp/server.ts (registerTool descriptions)
 *  - trigger guidance ........ templates/skill-instructions.md
 *  - CLI commands ............ src/cli/index.ts
 *  - supported assistants .... src/cli/installSkill.ts
 *  - confidence labels ....... src/core/types.ts + src/scoring/
 *
 * If a tool's signature changes on the server, update it here in the same commit.
 */

export interface GuideTool {
  name: string;
  /** What the agent calls it for, in the user's language. */
  purpose: string;
  /** A prompt that realistically causes an agent to reach for this tool. */
  prompt: string;
  /** Condensed input contract, matching the zod schema on the server. */
  input: string;
  group: "choose" | "check" | "detail" | "extra";
}

export const TOOL_GROUPS: { id: GuideTool["group"]; label: string; blurb: string }[] = [
  {
    id: "choose",
    label: "choosing what to use",
    blurb: "Reach for these instead of picking a dependency from memory.",
  },
  {
    id: "check",
    label: "checking before you install",
    blurb: "Catch hallucinated names, dead packages and peer conflicts before they hit your build.",
  },
  {
    id: "detail",
    label: "getting the details right",
    blurb: "Version-exact evidence, for when the model's recollection of an API is stale.",
  },
  { id: "extra", label: "extras", blurb: "Optional, and safe to skip." },
];

export const TOOLS: GuideTool[] = [
  {
    name: "recommend",
    group: "choose",
    purpose:
      "Best current packages for a need you describe, up to five, each scored with a confidence label. The one to call before settling on anything from memory — or before hand-rolling something that already exists.",
    prompt: "what should I use for form validation in a React app?",
    input: "need · optional category · optional constraints (runtime, license, max bundle KB, min confidence)",
  },
  {
    name: "compare",
    group: "choose",
    purpose: "Two to five named packages side by side, ranked by health score.",
    prompt: "compare zod, valibot and yup for me",
    input: "packages (2–5)",
  },
  {
    name: "plan",
    group: "choose",
    purpose:
      "A spec or README becomes an evidence-scored build plan: one lurq-scored package per component, plus a Mermaid roadmap. Pin what you've already decided and it recommends only the gaps, then optimizes the whole stack around your picks.",
    prompt: "here's my project spec — plan the stack, I'm already using Next.js and Postgres",
    input: "document and/or needs[] · optional using[] · optimize: speed | balanced",
  },
  {
    name: "verify",
    group: "check",
    purpose:
      "Is this package real, healthy, and not risky? Checks the live registry, so it catches hallucinated and typosquatted names (lodahs vs lodash) and packages carrying advisories.",
    prompt: "add react-hook-forms to the project",
    input: "package",
  },
  {
    name: "compat",
    group: "check",
    purpose:
      "Does this set form a coherent stack? Peer-dependency and engine-range math across the whole set, plus any sandbox-verified conflicts already on record. Returns the exact clashing constraints. Read-only — it never runs an install.",
    prompt: "will these versions actually work together on Node 20?",
    input: "packages (2–8) · optional exact versions · optional target Node version",
  },
  {
    name: "evaluate",
    group: "detail",
    purpose:
      "Everything known about one package: scores, signals, advisories, a summary and a usage guide. If lurq isn't tracking it yet, it fetches and scores it on the spot.",
    prompt: "is drizzle-orm actually maintained?",
    input: "package",
  },
  {
    name: "usage",
    group: "detail",
    purpose:
      "A version's real public API, extracted from its shipped .d.ts — exported symbols and signatures, exact to the version, none of it from the model's training data. Pass the version you were trained on and you get the precise delta: added, removed, renamed, changed.",
    prompt: "what changed in the zod API since v3?",
    input: "package · optional version · optional knownVersion",
  },
  {
    name: "diagram",
    group: "extra",
    purpose:
      "A reference-architecture Mermaid diagram for a stack you've already chosen, keyed by layer. A labeled starting point, not a validated architecture.",
    prompt: "draw the architecture for this stack",
    input: "optional stack[]",
  },
  {
    name: "report_outcome",
    group: "extra",
    purpose:
      "Opt-in feedback after you act on a recommendation: did you use it, and did it build? No source code leaves your machine — only the coarse decision and a build signal. This is what fills your activity feed.",
    prompt: "(your agent calls this on its own after a build)",
    input: "package · accepted · optional buildSignal · optional need",
  },
];

/** From templates/skill-instructions.md — the moments lurq is meant to intercept. */
export const TRIGGERS: { when: string; then: string; tool: string }[] = [
  {
    when: "You're about to pick a library for a need",
    then: "Describe the need and get scored candidates, instead of reaching for whatever was popular in 2023.",
    tool: "recommend",
  },
  {
    when: "You're about to hand-roll something",
    then: "Debounce, deep clone, date parsing — check first, don't rebuild a proven package.",
    tool: "recommend",
  },
  {
    when: "You're about to install a specific package",
    then: "Confirm the name is real and the package is healthy before it enters your lockfile.",
    tool: "verify",
  },
  {
    when: "You're weighing two or three options",
    then: "Get them ranked on evidence rather than vibes.",
    tool: "compare",
  },
  {
    when: "You're committing to a multi-package stack",
    then: "Check the set resolves together before you find out at install time.",
    tool: "compat",
  },
  {
    when: "You're writing code against an API you half-remember",
    then: "Get the version-exact symbols, and the delta from the version you know.",
    tool: "usage",
  },
];

export const ASSISTANTS = [
  { label: "Claude Code", logo: "/logos/claude-code.svg" },
  { label: "Cursor", logo: "/logos/cursor.svg" },
  { label: "Windsurf", logo: "/logos/windsurf.svg" },
  { label: "VS Code / Copilot", logo: "/logos/github-copilot.svg" },
  { label: "OpenAI Codex", logo: "/logos/codex.svg" },
  { label: "Gemini CLI", logo: "/logos/geminicli.svg" },
  { label: "Antigravity", logo: "/logos/antigravity.svg" },
  { label: "Kiro", logo: "/logos/kiro.svg" },
];

/** Confidence labels, in ascending evidence order (src/scoring). */
export const CONFIDENCE = [
  {
    label: "proven",
    tone: "good" as const,
    meaning: "High adoption, real age, and a recent release. Safe default.",
  },
  {
    label: "emerging",
    tone: "accent" as const,
    meaning: "Meaningful download volume, or strong 90-day growth. Worth a look.",
  },
  {
    label: "promising",
    tone: "warn" as const,
    meaning: "High intrinsic quality — types, tests, docs — but young or lightly used.",
  },
  {
    label: "unproven",
    tone: "neutral" as const,
    meaning: "Not enough evidence yet. Read the signals before committing.",
  },
];

/** Public CLI, from src/cli/index.ts. Most commands accept --json. */
export const CLI_COMMANDS = [
  { cmd: "lurq recommend <need>", does: "Scored candidates for a described need" },
  { cmd: "lurq evaluate <package>", does: "Full evidence read for one package" },
  { cmd: "lurq compare <pkgs…>", does: "Side-by-side, ranked by health" },
  { cmd: "lurq verify <package>", does: "Safety check before installing" },
  { cmd: "lurq compat <pkgs…>", does: "Does this set form a coherent stack?" },
  { cmd: "lurq usage <package>", does: "Version-exact API surface (--target, --known for the delta)" },
  { cmd: "lurq versions <package>", does: "Stored version timeline" },
  { cmd: "lurq plan <file>", does: "Markdown spec → scored plan (--optimize, --html)" },
  { cmd: "lurq weights", does: "Show the scoring model" },
  { cmd: "lurq install", does: "Guided setup for your assistants" },
];
