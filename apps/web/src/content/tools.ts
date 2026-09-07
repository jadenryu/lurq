/**
 * The ten tools an agent can call, as pages.
 *
 * THE RULE THIS FILE INHERITS. content/surfaces.ts already states it: these
 * panels show *structure*, never an answer. Every `args` entry below is the real
 * zod schema from src/mcp/server.ts, transcribed, and every `returns` entry is a
 * field that handler actually sets. Nothing here prints a score, a resolved
 * version, or a verdict, because those are claims about what the index says on a
 * given day and this file is not generated. content/agent-session.ts is where a
 * real recorded run lives, and it is the only place on the site allowed to show
 * one.
 *
 * A developer reading a tool page wants the schema more than they want a
 * screenshot of a number, so the constraint costs nothing.
 *
 * WHEN A TOOL CHANGES. server.ts is the source. Re-read the registration, not
 * this file: a description improved for agents should reach the page too, and
 * the reverse edit (improving the page and leaving the agent with the old
 * sentence) is the drift this comment exists to prevent.
 *
 * House rules from content/copy.ts: sentence case, no em dashes, and the word
 * the hero spends is not spent again here.
 */
import type { DiagramName } from "@/components/site/diagrams";

export interface ToolArg {
  name: string;
  /** As declared, e.g. `string`, `string[] (2-30)`, `boolean`. */
  type: string;
  required: boolean;
  note: string;
}

export interface ToolField {
  name: string;
  note: string;
}

export interface Tool {
  /** URL segment, and the name an agent calls. They are deliberately the same. */
  slug: string;
  /** The question a developer would ask, in their words. */
  question: string;
  /** Page H1. Short enough to survive a 2-line clamp at 320px. */
  title: string;
  /** One paragraph under the H1. Two sentences at most. */
  lead: string;
  /** Rail label in the showcase tabs. One or two words. */
  tab: string;
  /** The group this sits in on /product. */
  group: "Check" | "Fit" | "Surface" | "Feedback";
  args: ToolArg[];
  returns: ToolField[];
  /** Three steps, present tense, no subject. Rendered as a numbered strip. */
  mechanism: [string, string, string];
  /** One line. The sentence that tells an agent when to reach for this. */
  whenToCall: string;
  /** Request body, pretty-printed. Structure only: names are real packages. */
  call: string;
  /** Response skeleton. Types and enums, never values. */
  shape: string;
  figure: DiagramName;
  /** Other slugs. Two, so the row never wraps. */
  related: [string, string];
}

export const TOOLS: Tool[] = [
  {
    slug: "verify",
    question: "Is this package real?",
    title: "Verify",
    lead: "Confirms an npm package exists, is maintained, and is not carrying anything you would not have installed knowingly. It is the check that catches a name a model produced fluently and spelled the way a real one would be spelled.",
    tab: "Verify",
    group: "Check",
    args: [{ name: "package", type: "string", required: true, note: "npm package name to verify" }],
    returns: [
      { name: "exists", note: "Whether the registry has it at all. The hallucination check." },
      { name: "score", note: "Composite health, from maintenance cadence, advisories and adoption." },
      { name: "advisories", note: "Open security advisories against the resolved version." },
      { name: "deprecated", note: "The registry's own deprecation flag, and its message." },
      { name: "risk", note: "Typosquat proximity to a high-traffic name, and install-script presence." },
    ],
    mechanism: [
      "Reads the live registry rather than the index, so a package published an hour ago resolves.",
      "Scores what came back against maintenance cadence, open advisories and deprecation state.",
      "Measures edit distance to the popular names it is closest to, which is what makes a typosquat visible.",
    ],
    whenToCall: "Before installing anything a model named rather than something you looked up.",
    call: `{
  "package": "reqeusts"
}`,
    shape: `{
  "exists":     boolean,
  "score":      number,          // 0-100
  "deprecated": string | null,
  "advisories": Advisory[],
  "risk": {
    "typosquatOf":   string | null,
    "installScript": boolean
  }
}`,
    figure: "verify",
    related: ["evaluate", "compat"],
  },
  {
    slug: "evaluate",
    question: "Should I depend on this?",
    title: "Evaluate",
    lead: "The full evidence read on one package: every score, every signal behind it, the open advisories, and a usage guide. Fetches and scores on demand when the index has not seen the package before.",
    tab: "Evaluate",
    group: "Check",
    args: [{ name: "package", type: "string", required: true, note: "npm package name" }],
    returns: [
      { name: "scores", note: "The composite, and each axis that fed it, so a low number can be argued with." },
      { name: "signals", note: "The raw measurements: release cadence, issue latency, contributor spread." },
      { name: "advisories", note: "Open advisories, with severity and the range each one affects." },
      { name: "summary", note: "What the package is for, written from its own metadata." },
      { name: "usage", note: "The install line and the first import, version-exact." },
    ],
    mechanism: [
      "Looks the package up in the index, and fetches plus scores it live when it is not there yet.",
      "Returns every axis separately rather than one number, because an agent choosing between two packages needs to know which axis they differ on.",
      "Carries the advisories through unsummarised, since severity is the reader's call and not ours.",
    ],
    whenToCall: "When a package is a real candidate and the decision is whether to commit to it.",
    call: `{
  "package": "drizzle-orm"
}`,
    shape: `{
  "scores":     { "overall": number, [axis: string]: number },
  "signals":    Signal[],
  "advisories": Advisory[],
  "summary":    string,
  "usage":      { "install": string, "import": string }
}`,
    figure: "evaluate",
    related: ["compare", "verify"],
  },
  {
    slug: "compare",
    question: "Which of these should I pick?",
    title: "Compare",
    lead: "Two to five candidates, side by side, ranked on the same evidence rather than on how often each name appeared in training text. The ranking is the least interesting part of the answer: the axes are what tells you whether the winner wins on something you care about.",
    tab: "Compare",
    group: "Check",
    args: [
      { name: "packages", type: "string[] (2-5)", required: true, note: "2-5 npm package names" },
    ],
    returns: [
      { name: "ranked", note: "The set in health-score order, highest first." },
      { name: "axes", note: "Per-package scores on each axis, so a tie on the composite can still be broken." },
      { name: "divergence", note: "The axes the candidates actually differ on, which is usually one or two." },
    ],
    mechanism: [
      "Scores every candidate through the same pipeline, so the comparison is between measurements and not between reputations.",
      "Surfaces the axes where the set disagrees, because the ones they all score alike carry no decision.",
      "Ranks last. A composite is a summary of the table above it, not a verdict that replaces it.",
    ],
    whenToCall: "When the shortlist is already down to a handful and the question is which one.",
    call: `{
  "packages": ["zod", "valibot", "yup"]
}`,
    shape: `{
  "ranked": [{ "package": string, "overall": number }],
  "axes":   { [axis: string]: { [pkg: string]: number } },
  "divergence": string[]
}`,
    figure: "compare",
    related: ["evaluate", "compat"],
  },
  {
    slug: "compat",
    question: "Will these install together?",
    title: "Compat",
    lead: "Resolves a whole candidate stack the way npm would and returns a definitive verdict: compatible, conflict with the exact clashing constraints, or unknown. Read-only, and it never installs or executes package code.",
    tab: "Compat",
    group: "Fit",
    args: [
      {
        name: "packages",
        type: "string[] (2-30)",
        required: true,
        note: "The full candidate stack, checked together. A whole dependency list is the intended input.",
      },
      {
        name: "versions",
        type: "Record<string, string>",
        required: false,
        note: 'Exact versions keyed by name, e.g. {"react":"19.0.0"}. Exact semver, never a range.',
      },
      {
        name: "node",
        type: "string",
        required: false,
        note: 'Target runtime for the engines check, e.g. "20" or "20.20.2".',
      },
    ],
    returns: [
      { name: "verdict", note: '"compatible", "conflict" or "unknown". Never a probability.' },
      { name: "pairs", note: "Every pair in the set, each with its own status and the requirement that decided it." },
      { name: "conflicts", note: "The clashing peer ranges, named, with the version each side resolved to." },
      { name: "engines", note: "Declared Node floors against the runtime you passed." },
    ],
    mechanism: [
      "Takes the whole set in one call. Conflicts routinely appear only across the set, a peer range three packages deep, so checking pairs one at a time misses them and costs a round trip each.",
      "Grades declared peer ranges first, then falls back to co-installs already recorded in the compatibility matrix.",
      "Returns unknown rather than guessing. A confident verdict on an unmeasured pair is the failure mode this tool exists to remove.",
    ],
    whenToCall: "Before committing to a multi-package stack, and before any version bump that touches more than one.",
    call: `{
  "packages": [
    "next",
    "typescript",
    "@typescript-eslint/eslint-plugin"
  ],
  "node": "20"
}`,
    shape: `{
  "verdict": "compatible" | "conflict" | "unknown",
  "pairs": [{
    "a": string, "b": string,
    "status": "ok" | "conflict" | "unknown",
    "requirement": { "peer": string, "range": string, "resolved": string }
  }],
  "engines": [{ "package": string, "node": string, "satisfied": boolean }]
}`,
    figure: "compat",
    related: ["usage", "diff_surface"],
  },
  {
    slug: "usage",
    question: "What is the API at this version?",
    title: "Usage",
    lead: "A version's real public API, read out of its shipped .d.ts rather than out of a model's memory. Pass the version you already know and the answer comes back as a delta: what moved, what went, what is new.",
    tab: "Usage",
    group: "Fit",
    args: [
      { name: "package", type: "string", required: true, note: "npm package name" },
      { name: "version", type: "string", required: false, note: "Target version. Defaults to latest." },
      {
        name: "knownVersion",
        type: "string",
        required: false,
        note: "A version you already know. Returns the API delta from it to the target.",
      },
    ],
    returns: [
      { name: "exports", note: "Exported symbols and their signatures, exact to the version." },
      { name: "delta", note: "Added, removed, renamed and changed, when knownVersion was passed." },
      { name: "engines", note: "The declared runtime floor, so you do not write against a version your target cannot install." },
    ],
    mechanism: [
      "Extracts from the version's own shipped type declarations, which is the only description of the API that ships with the code.",
      "Diffs against the version you name, so the answer is scoped to what you would have to change.",
      "Carries engines through in the same response, because a correct API on an uninstallable version is not a usable answer.",
    ],
    whenToCall: "Before writing code against a package whose API may have moved since the model last read it.",
    call: `{
  "package": "zod",
  "version": "4.1.12",
  "knownVersion": "3.23.8"
}`,
    shape: `{
  "exports": [{ "name": string, "kind": string, "signature": string }],
  "delta": {
    "added":   string[],
    "removed": string[],
    "changed": [{ "name": string, "from": string, "to": string }]
  },
  "engines": { "node": string }
}`,
    figure: "usage",
    related: ["resolve_surface", "diff_surface"],
  },
  {
    slug: "diagram",
    question: "What does this stack look like?",
    title: "Diagram",
    lead: "A reference-architecture diagram for a stack you have already chosen, emitted as Mermaid so the agent that asked for it can render or parse it. A labelled starting point keyed by layer, and deliberately not an architecture designer.",
    tab: "Diagram",
    group: "Fit",
    args: [
      {
        name: "stack",
        type: "string[]",
        required: false,
        note: "The package names that make up the stack. Omit for usage guidance instead.",
      },
    ],
    returns: [
      { name: "mermaid", note: "The diagram source, ready to render." },
      { name: "layers", note: "Which layer each package was placed in, and why." },
      { name: "gaps", note: "Layers nothing in the set fills." },
    ],
    mechanism: [
      "Places each named package into the layer its category implies, from the index's own classification.",
      "Emits Mermaid rather than an image, so the caller can parse the structure instead of looking at it.",
      "Names the empty layers. A gap is the part of a stack diagram worth reading.",
    ],
    whenToCall: "Once the stack is chosen, to get a shared picture of it into a README or a review.",
    call: `{
  "stack": ["next", "drizzle-orm", "postgres", "clerk"]
}`,
    shape: `{
  "mermaid": string,
  "layers":  { [layer: string]: string[] },
  "gaps":    string[]
}`,
    figure: "diagram",
    related: ["compat", "compare"],
  },
  {
    slug: "resolve_surface",
    question: "Does this symbol actually exist?",
    title: "Resolve surface",
    lead: "What a version exports at runtime, extracted from its shipped JavaScript rather than from documentation. Runtime existence is what decides whether an import throws: a removed type breaks tsc, a removed runtime symbol breaks the program.",
    tab: "Resolve",
    group: "Surface",
    args: [
      { name: "package", type: "string", required: true, note: "npm package name" },
      { name: "version", type: "string", required: false, note: "Exact version. Omit for the latest extracted." },
    ],
    returns: [
      { name: "symbols", note: "Every runtime export, with its kind." },
      { name: "status", note: '"resolved" or "UNKNOWN". UNKNOWN never means the symbol is absent.' },
      { name: "queued", note: "Set when a miss started an extraction, so a retry is worth making." },
    ],
    mechanism: [
      "Reads the published JavaScript, not the types and not the README, because those three disagree more often than anyone expects.",
      "Returns UNKNOWN on a miss and queues the extraction, rather than reporting an absence it has not verified.",
      "Keys everything to the exact version, since a surface answer that is not version-exact is a guess with extra steps.",
    ],
    whenToCall: "When an import is failing and the question is whether the symbol was ever there.",
    call: `{
  "package": "react-dom",
  "version": "19.2.4"
}`,
    shape: `{
  "status":  "resolved" | "UNKNOWN",
  "symbols": [{ "name": string, "kind": "function" | "class" | "const" }],
  "queued":  boolean
}`,
    figure: "resolve",
    related: ["usage", "diff_surface"],
  },
  {
    slug: "diff_surface",
    question: "What broke between these versions?",
    title: "Diff surface",
    lead: "Symbols removed, added and changed in arity between two versions, from static comparison with nothing installed. Removals that break node come back separately from the type-only removals that break tsc, because they are different emergencies.",
    tab: "Diff",
    group: "Surface",
    args: [
      { name: "package", type: "string", required: true, note: "npm package name" },
      { name: "fromVersion", type: "string", required: true, note: "The version you are on" },
      { name: "toVersion", type: "string", required: true, note: "The version you are moving to" },
    ],
    returns: [
      { name: "removed", note: "Runtime symbols that are gone. These break node." },
      { name: "removedTypes", note: "Type-only removals, returned apart. These break tsc." },
      { name: "added", note: "New exports, so a migration can use them rather than working around them." },
      { name: "arity", note: "Signatures whose parameter count moved, which is the break that compiles and then throws." },
    ],
    mechanism: [
      "Compares two extracted surfaces directly. No install, no sandbox, no network beyond the two reads.",
      "Splits runtime removals from type removals, because one fails at run time and one at build time and the fix differs.",
      "Reports arity changes on their own, since a call that still resolves and now takes different arguments is the quietest break there is.",
    ],
    whenToCall: "Before an upgrade, and after one to explain a break you are already looking at.",
    call: `{
  "package": "typescript",
  "fromVersion": "5.9.3",
  "toVersion": "7.0.0"
}`,
    shape: `{
  "removed":      string[],
  "removedTypes": string[],
  "added":        string[],
  "arity": [{ "name": string, "from": number, "to": number }]
}`,
    figure: "diff",
    related: ["usage", "resolve_surface"],
  },
  {
    slug: "capabilities",
    question: "Which tool answers this?",
    title: "Capabilities",
    lead: "A lookup rather than a guess. An agent holding ten lurq tools still has to work out which one covers the situation in front of it, and this returns the exact tool name to call next instead of prose about it.",
    tab: "Capabilities",
    group: "Feedback",
    args: [
      {
        name: "query",
        type: "string (max 300)",
        required: false,
        note: "What you are trying to do, in plain words. Omit for the full menu.",
      },
    ],
    returns: [
      { name: "capabilities", note: "Matching entries, each naming the tool or CLI command to run." },
      { name: "next", note: "The single call to make, when one match is clearly the answer." },
    ],
    mechanism: [
      "Reads nothing. No index query, no key, and no usage row, because asking what a tool does is not usage of it.",
      "Matches on the situation rather than the tool name, so a caller who does not know the vocabulary still lands on the right tool.",
      "Returns the call, not a description of it. A menu that needs interpreting is a second guess.",
    ],
    whenToCall: "When you are unsure whether lurq covers something, instead of guessing or skipping it.",
    call: `{
  "query": "the upgrade broke my build, which version removed it"
}`,
    shape: `{
  "capabilities": [{
    "title": string,
    "tool":  string,
    "call":  string
  }]
}`,
    figure: "capabilities",
    related: ["diff_surface", "verify"],
  },
  {
    slug: "report_outcome",
    question: "Did the recommendation hold?",
    title: "Report outcome",
    lead: "Opt-in feedback after acting on a recommendation: whether you went with the package, and whether it built. No source code leaves the machine, only the coarse decision and a build signal, and skipping it is always safe.",
    tab: "Outcome",
    group: "Feedback",
    args: [
      { name: "package", type: "string", required: true, note: "The package that was recommended" },
      { name: "accepted", type: "boolean", required: true, note: "Did you go with it?" },
      {
        name: "buildSignal",
        type: '"installed" | "compiled" | "tests_passed" | "failed"',
        required: false,
        note: "Coarse post-install result, if known",
      },
      {
        name: "need",
        type: "string (max 500)",
        required: false,
        note: "The original need this was recommended for. No source code.",
      },
    ],
    returns: [{ name: "recorded", note: "Acknowledgement. The tool returns nothing about the package." }],
    mechanism: [
      "Attributes the report to the authenticated key rather than to anything in the arguments, so a caller cannot write a row against someone else.",
      "Stores four coarse fields and nothing else. There is no free-text channel wide enough to carry code by accident.",
      "Feeds the acceptance signal back into scoring, which is how the index learns which packages agents actually succeed with.",
    ],
    whenToCall: "After acting on a recommendation, when the build result is already known.",
    call: `{
  "package": "drizzle-orm",
  "accepted": true,
  "buildSignal": "tests_passed"
}`,
    shape: `{
  "recorded": boolean
}`,
    figure: "outcome",
    related: ["evaluate", "capabilities"],
  },
];

export const TOOL_BY_SLUG = new Map(TOOLS.map((t) => [t.slug, t]));

/** Preserves the order in TOOLS: the groups read Check, Fit, Surface, Feedback. */
export const TOOL_GROUPS = Array.from(
  TOOLS.reduce((acc, tool) => {
    const list = acc.get(tool.group) ?? [];
    list.push(tool);
    return acc.set(tool.group, list);
  }, new Map<Tool["group"], Tool[]>()),
);

// ── section copy ─────────────────────────────────────────────────────────────

export const PRODUCT_HEAD = "Ten calls, and none of them are a guess.";
export const PRODUCT_LEAD =
  "Every tool below is registered on the MCP server today. The panels show the schema each one accepts and the shape of what comes back, never a stored answer: a verdict printed on a marketing page is a claim about a day that has already passed.";

export const SHOWCASE_HEAD = "The whole surface, one call at a time.";
