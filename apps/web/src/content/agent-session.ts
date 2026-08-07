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
 * The three packages the exchange is about. A `compat` run over the full five
 * would put an unrelated eslint conflict in a panel about auth, which reads as
 * two findings competing rather than one landing.
 */
export const SESSION_PACKAGES = ["next", "@auth/core", "next-auth"] as const;

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

export const SESSION_REQUEST = "Add auth to my Next app.";

/**
 * Written the way a model actually answers: specific, plausible, and stated
 * without hedging. It is not a strawman. next-auth and @auth/core is the pairing
 * an agent reaches for, and it is exactly the pairing the run says breaks.
 */
export const SESSION_PROPOSAL = "I'll add next-auth alongside @auth/core.";

export const SESSION_TOOL = "compat";
export const SESSION_TOOL_ARGS = SESSION_PACKAGES.join(" ");

/**
 * The correction, in two parts: what changed, then why. The "why" is not written
 * here at all, it is SESSION_DETAIL, so the reason on screen is the reason the
 * product gave.
 */
export const SESSION_CORRECTION = `Pinning @auth/core to ${CONFLICT.requirement.range} before install.`;

/** Says what the panel is. Sits under it, and is not optional. */
export const SESSION_CAPTION =
  "A staged request. The versions, the verdicts, and the reason are read from a recorded run, not written for this page.";

/**
 * The run itself, named so the claim above it is checkable. Forced to UTC: a
 * date-only render in the local zone puts the wrong day on a page whose argument
 * is that dates matter.
 */
function recordedOn(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d
    .toLocaleDateString("en-GB", {
      day: "numeric",
      month: "short",
      year: "numeric",
      timeZone: "UTC",
    })
    .toLowerCase();
}

/** The command, printed so the claim above it can be re-run rather than trusted. */
export const SESSION_RUN_COMMAND = run.source;

/**
 * The panel shows three of the run's five packages, and says so rather than
 * letting a reader match the command against the chips and come up short. Kept
 * off the command's line: centred together they wrap into an orphan.
 */
export const SESSION_RUN_META =
  `recorded ${recordedOn(run.generatedAt)} · ` +
  `${SESSION_PACKAGES.length} of its ${run.packages.length} packages shown`;
