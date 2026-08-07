/**
 * The exchange the session panel replays: an agent about to install the wrong
 * thing, the lurq call that catches it, and the correction.
 *
 * WHAT IS STAGED AND WHAT IS NOT. The three prose lines below (the request, the
 * agent's proposal, the agent's correction) are written here. Nobody recorded
 * this conversation. The panel says so on the page, and it must keep saying so:
 * the moment it reads as a transcript, every line in it becomes a claim we
 * cannot back.
 *
 * Everything the panel treats as a *finding* is the opposite: it is read out of
 * content/hero-run.json, which scripts/gen-hero-run.ts wrote from a real
 * `lurq compat` run and refuses to write at all if the CLI fails. Package names,
 * resolved versions, every pair verdict, and the conflict sentence are pulled
 * from that file at build time and are not restated here. Re-run the generator
 * and this section re-renders against the new truth, or fails loudly.
 *
 * The panel used to carry a caption naming all of this on the page. That has
 * been removed at request; the guard below has not, so the section still cannot
 * render a conflict the run does not report. What is gone is the disclosure, not
 * the constraint.
 *
 * That split is the same one content/hero-split.ts draws, for the same reason.
 * If you edit this file, you may rewrite the prose. You may not type a version
 * number, a peer range, or a verdict into it.
 */
import run from "@/content/hero-run.json";

/** The shape gen-hero-run.ts lifts to the top level of the run file. */
type Pair = {
  a: string;
  b: string;
  status: string;
  detail?: string;
  requirement?: { peer: string; range: string; resolved: string };
};

const PAIRS = run.pairs as Pair[];
const VERSIONS = new Map(run.packages.map((p) => [p.name, p.version]));

/**
 * The three packages the exchange is about.
 *
 * This used to be the auth trio (next, @auth/core, next-auth). The finding there
 * was real but it did not read: next-auth v4 pinning an exact @auth/core is a
 * narrow, arbitrary-looking number, and the v4/v5/Auth.js renaming means most
 * readers cannot tell whether they are looking at a bug or at two libraries with
 * confusing names.
 *
 * The TypeScript 7 pair is the same mechanism with a story everyone already
 * knows. TS 7 shipped the Go compiler without a stable programmatic API — that
 * lands in 7.1 — so typescript-eslint still declares support for <6.1.0. npm
 * refuses the install outright, and forcing it past the error crashes eslint
 * inside typescript-estree. "Upgrade me to TypeScript 7" is a request people
 * actually make, and this is what happens when nothing checks it first.
 *
 * `next` earns its place by being the one pair that holds: a panel where every
 * chip is red reads as a broken stack rather than as a check that found one
 * thing.
 */
export const SESSION_PACKAGES = [
  "next",
  "typescript",
  "@typescript-eslint/eslint-plugin",
] as const;

/** Fails the build rather than rendering a chip with no version under it. */
function versionOf(name: string): string {
  const v = VERSIONS.get(name);
  if (!v) {
    throw new Error(
      `agent-session: "${name}" is not in hero-run.json. Re-run scripts/gen-hero-run.ts ` +
        `or change SESSION_PACKAGES to match the run.`,
    );
  }
  return v;
}

/** Every pair among the three, with the verdict the run actually returned. */
function pairsAmong(names: readonly string[]): Pair[] {
  const set = new Set(names);
  return PAIRS.filter((p) => set.has(p.a) && set.has(p.b));
}

export const SESSION_PAIRS = pairsAmong(SESSION_PACKAGES);

/**
 * The finding the panel is built around. Located by verdict rather than by name
 * so that a re-run which resolves this conflict cannot leave the panel asserting
 * it: if `compat` stops reporting a conflict here, the build stops too.
 */
const CONFLICT = SESSION_PAIRS.find((p) => p.status === "conflict");

if (!CONFLICT?.detail || !CONFLICT.requirement) {
  throw new Error(
    "agent-session: hero-run.json reports no conflict with a detail line among " +
      `${SESSION_PACKAGES.join(", ")}, so there is nothing for the agent to catch. ` +
      "Re-run scripts/gen-hero-run.ts, or rewrite this section against what it now returns.",
  );
}

export const SESSION_CONFLICT = CONFLICT;
/** The CLI's own sentence, rendered verbatim. Never paraphrased on the page. */
export const SESSION_DETAIL = CONFLICT.detail;
export const SESSION_REQUIREMENT = CONFLICT.requirement;

export const SESSION_CHIPS = SESSION_PACKAGES.map((name) => ({
  name,
  version: versionOf(name),
  /** conflict if this package is named in the finding, else held. */
  status:
    CONFLICT.a === name || CONFLICT.b === name ? ("conflict" as const) : ("held" as const),
}));

// ── the staged prose ────────────────────────────────────────────────────────

/** The client the exchange is shown in. One of the marquee's own install targets. */
export const SESSION_CLIENT = "Claude Code";
export const SESSION_CLIENT_MARK = "/logos/claude-code.svg";

/**
 * The section's own heading. A label and one line, and deliberately nothing
 * else: the panel below spends four seconds demonstrating this, and a paragraph
 * here would be explaining what is about to be shown.
 */
/**
 * "Ask for an upgrade. See what it would have broken." was the draft and it had
 * two problems. "it" had no clear referent: the upgrade, the model, or lurq, and
 * a reader has to pick. And "would have broken" is a counterfactual, which puts
 * the breakage in a past that never happened while the panel underneath is
 * showing a check that runs beforehand. Present tense, named subject.
 */
export const SESSION_HEAD = "Ask for an upgrade. Find out what breaks first.";

/**
 * What lurq is actually doing, in plain words, because the section did not say
 * anywhere. It had a label, a headline, a panel and three notes, and a reader who
 * did not already know what an MCP tool call was got no explanation of the
 * mechanism at all. Two sentences, before the artifact rather than after it.
 */
export const SESSION_BODY =
  "When a request touches packages, lurq resolves the versions from the registry, analyzing compatibility, and reports the clashes. We do this before anything is written to your project.";

export const SESSION_REQUEST = "Upgrade me to TypeScript 7.";

/**
 * What the composer reads before the request types itself. Deliberately not a
 * lurq instruction: nobody tells their agent to call lurq, the agent calls it
 * because it is a tool it has. A placeholder reading "ask lurq to..." would
 * describe a product this is not.
 */
export const SESSION_PLACEHOLDER = "Ask for a package...";

/** Shown while the tool call is in flight, in the tool's own vocabulary. */
export const SESSION_CALLING = "calling mcp · lurq";

/**
 * Written the way a model actually answers: specific, plausible, and stated
 * without hedging. It is not a strawman. Bumping the compiler and leaving the
 * lint toolchain alone is the obvious move, and it is exactly the move the run
 * says breaks.
 */
export const SESSION_PROPOSAL = "I'll bump typescript to 7 and leave the lint setup as it is.";

/**
 * What the install actually does if nothing checks first. Staged prose, so it
 * names no version and no verdict: npm's refusal is a fact about peer ranges in
 * general, not a number read off this run.
 */
export const SESSION_CONSEQUENCE = "Left alone, npm refuses the install.";

export const SESSION_TOOL = "compat";
export const SESSION_TOOL_ARGS = SESSION_PACKAGES.join(" ");

/**
 * The correction, in two parts: what changed, then why. The "why" is not written
 * here at all, it is SESSION_DETAIL, so the reason on screen is the reason the
 * product gave.
 */
export const SESSION_CORRECTION =
  `Holding ${CONFLICT.requirement.peer} at ${CONFLICT.requirement.range} ` +
  `until the plugin supports ${CONFLICT.requirement.resolved}.`;

/**
 * The result line on the tool call, so the check reports what it did rather than
 * only what it found. Counted off the run, not written: a hardcoded "1 conflict"
 * would go stale the first time a re-run turns up two.
 */
const CONFLICT_COUNT = SESSION_PAIRS.filter((p) => p.status === "conflict").length;
export const SESSION_RESULT =
  `${SESSION_PAIRS.length} pairs · ` +
  `${CONFLICT_COUNT} ${CONFLICT_COUNT === 1 ? "conflict" : "conflicts"}`;

/**
 * What was in the panel, said once in plain language after it has played.
 *
 * The panel is the demonstration and this is the reading of it. Someone who has
 * never resolved a peer range should be able to follow all three, which is why
 * none of them say "peer range" without also saying what breaks.
 *
 * The package names and the pinned version come out of the run rather than being
 * typed here, for the same reason nothing else on this page types a version: if
 * the run changes, this changes with it or the build fails.
 */
export const SESSION_NOTES = [
  {
    index: "01",
    title: "It answers from memory",
    body:
      "Upgrading the compiler is the obvious move, and the model makes it without hesitating. " +
      "Nothing in the editor knows which of your other tools have caught up yet.",
  },
  {
    index: "02",
    title: "lurq reads what is true today",
    body:
      `One call, ${SESSION_PACKAGES.length} packages, resolved against the registry and checked ` +
      "against the versions each one currently admits to supporting.",
  },
  {
    index: "03",
    title: "You find out now, not at install",
    body:
      `${SESSION_PACKAGES[2]} still declares support for ${CONFLICT.requirement.range}, so npm ` +
      `refuses to put it next to ${CONFLICT.requirement.resolved}. You get the held version ` +
      "instead of a failed install and twenty minutes of working out why.",
  },
] as const;
