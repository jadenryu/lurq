/**
 * Four use cases, one page each.
 *
 * BY USE CASE, NOT BY PERSONA. A persona page ("for platform teams") is a claim
 * about who uses this, and lurq has no named customers to back one. A use-case
 * page is a claim about what the tools do, and every claim below names the tool
 * that makes it. That is the difference between a solutions section that is
 * evidence and one that is a wish, and it is the reason there is no logo wall
 * anywhere in here.
 *
 * EVERY `tools` ENTRY IS A REGISTERED TOOL. They are slugs from content/tools.ts
 * and the template links them, so a page cannot name a capability that has no
 * page behind it. If a tool is ever unregistered, the link 404s loudly rather
 * than the copy quietly continuing to promise it.
 *
 * House rules from content/copy.ts: sentence case, no em dashes, and the word
 * the hero spends is spent sparingly. `agent-coding` is allowed one use because
 * the page is about that word.
 */
import type { DiagramName } from "@/components/site/diagrams";

export interface Solution {
  slug: string;
  /** Rail and card label. Two or three words. */
  name: string;
  /** Card blurb and meta description. One sentence. */
  blurb: string;
  /** Page H1. */
  title: string;
  /** One paragraph under the H1. */
  lead: string;
  /** The section that argues the problem exists. Two short paragraphs. */
  problem: [string, string];
  /** Three steps. Present tense, and each one names what actually happens. */
  steps: { title: string; body: string }[];
  /** Tool slugs from content/tools.ts. Rendered as links. */
  tools: string[];
  /**
   * The line that makes the page checkable rather than persuasive. Always
   * something a reader can verify, never a testimonial.
   */
  evidence: string;
  figure: DiagramName;
}

export const SOLUTIONS: Solution[] = [
  {
    slug: "agent-coding",
    name: "Agent-assisted coding",
    blurb: "Check the suggestion in the gap before it becomes an install.",
    title: "The agent picks the dependency now. Something has to check it.",
    lead: "A coding assistant chooses a package in the time it takes to read the sentence asking for one, from a snapshot of the registry that stopped updating on the day its training did. lurq is the call it makes in between.",
    problem: [
      "For twenty years a developer chose the dependency, and the choosing was slow enough to include a look at the repo. That step is gone. The package name now arrives inside a diff, already installed, chosen because it appeared often in text rather than because it is healthy today.",
      "The failure is quiet in exactly the way that costs the most. Nothing errors at suggestion time. It errors at install, or at build, or three weeks later when a peer range nobody read turns out to have been incompatible the whole time.",
    ],
    steps: [
      {
        title: "The name is checked against the live registry",
        body: "Not against the index and not against a cache. A package published this morning resolves, and a package that has never existed comes back as not existing, which is the check that catches a fluent invention.",
      },
      {
        title: "The whole candidate set is resolved together",
        body: "One call with every package in it, because a conflict three packages deep is invisible to a pairwise check and costs a round trip per pair to miss.",
      },
      {
        title: "The API is read at the version being installed",
        body: "Exported symbols out of the version's own shipped files, so the model writes against what is there rather than against what it remembers.",
      },
    ],
    tools: ["verify", "compat", "usage"],
    evidence:
      "Published research puts hallucinated package names above 5% of commercial-model recommendations, and the same invented names recur across runs, which is what makes them registrable by someone else.",
    figure: "verify",
  },
  {
    slug: "upgrades",
    name: "Upgrades and migrations",
    blurb: "Know what breaks before you bump the version, not after.",
    title: "Find out what the upgrade removes before you run it.",
    lead: "A major version bump is a question about symbols: which ones went, which changed shape, and which of those two failure modes you are about to hit. Both answers are in the published artifacts, and neither requires installing anything.",
    problem: [
      "The changelog is written by people, for people, and it is written about intent. The thing that breaks your build is the export that quietly stopped being exported, which is a fact about a file rather than a fact about a release.",
      "So the upgrade gets attempted, the build fails somewhere unhelpful, and the next hour goes on working backwards from a stack trace to a version number. That work is a diff, and a diff is a thing a machine should do.",
    ],
    steps: [
      {
        title: "Compare the two surfaces directly",
        body: "The symbols in the version you are on against the symbols in the one you are moving to, from static comparison. No install, no sandbox, no lockfile touched.",
      },
      {
        title: "Separate what breaks node from what breaks tsc",
        body: "A removed runtime export throws at import. A removed type fails the compiler and runs fine. They come back apart because the fix is different and the urgency is different.",
      },
      {
        title: "Check the rest of the stack still resolves",
        body: "A bump is rarely one package. The set is re-resolved against the new version so a peer range that used to be satisfied does not become the thing you discover in CI.",
      },
    ],
    tools: ["diff_surface", "usage", "compat"],
    evidence:
      "The index has extracted 23,942 API surfaces across 4.02M tracked versions, which is what makes a two-version diff a lookup rather than an install.",
    figure: "diff",
  },
  {
    slug: "ci",
    name: "Pre-merge gating",
    blurb: "Fail the build on a dependency nobody actually checked.",
    title: "Put the check where the merge is, not where the incident is.",
    lead: "Review catches a bad function and misses a bad dependency, because a dependency looks the same in a diff whether it is maintained or abandoned. The CLI turns that into a step that either passes or does not.",
    problem: [
      "Nobody opens the repo behind a package added in someone else's pull request. The line is one string in a manifest and it reads as fine, which is precisely why the dependency is the part of a diff that gets waved through.",
      "The result is a class of incident with no author. No one chose the abandoned package, no one approved the advisory, and by the time it matters the commit is months old and the person who wrote it has moved on.",
    ],
    steps: [
      {
        title: "Run it against the manifest, in the pipeline",
        body: "The CLI reads the dependency list, resolves the set, and exits non-zero on a conflict or a flagged package. It is a step, not a dashboard somebody has to remember to look at.",
      },
      {
        title: "Pin the runtime you actually deploy on",
        body: "Declared engines can range, so a stack can resolve perfectly on the runner and still die in production because one package does not support the Node you ship. Pass the version and it is checked.",
      },
      {
        title: "Keep the result next to the diff",
        body: "The verdict belongs where the decision is being made. A finding that arrives in a weekly report is a finding about a merge that already happened.",
      },
    ],
    tools: ["compat", "verify", "evaluate"],
    evidence:
      "The CLI run against your own database is unmetered and always will be. The hosted index is what the paid plans buy, and the free plan never asks for a card.",
    figure: "compat",
  },
  {
    slug: "supply-chain",
    name: "Supply-chain defence",
    blurb: "Catch the package name a model invented before someone registers it.",
    title: "The most dangerous package name is the one that does not exist yet.",
    lead: "A model that invents a package name invents the same one repeatedly. That makes the name predictable, and a predictable name is one an attacker can register and wait on. The defence is checking existence at suggestion time.",
    problem: [
      "Typosquatting used to need a typo. It does not any more: a confidently produced name that was never real is a better target than a misspelling, because nothing about it looks wrong and the developer who installs it was never trying to type something else.",
      "The window is the gap between the model producing the name and the install running. It is measured in seconds, it is entirely automated, and there is no human step in it where a person could notice.",
    ],
    steps: [
      {
        title: "Check the registry, not a memory",
        body: "Existence is a live question with a live answer. A name that resolves to nothing comes back as nothing, which is the whole check.",
      },
      {
        title: "Measure the distance to the real names",
        body: "A name sitting one edit away from a high-traffic package is reported as such. Sitting inside someone else's neighbourhood is the signal, and it is a measurement rather than a heuristic about spelling.",
      },
      {
        title: "Flag what runs on install",
        body: "Install scripts are surfaced before the install, because that is the only moment at which knowing about one is still useful.",
      },
    ],
    tools: ["verify", "evaluate", "compare"],
    evidence:
      "Existence is checked against the live npm registry on every call, not against the index. A package registered an hour ago resolves, and so does the absence of one that was never registered at all.",
    figure: "verify",
  },
];

export const SOLUTION_BY_SLUG = new Map(SOLUTIONS.map((s) => [s.slug, s]));

// ── section copy ─────────────────────────────────────────────────────────────

export const SOLUTIONS_HEAD = "Four places the same check pays for itself.";
export const SOLUTIONS_LEAD =
  "The tools do not change between these. What changes is when the call happens, and every one of them is the same argument: the cheapest moment to find out is before, and every moment after that is more expensive than the last.";
