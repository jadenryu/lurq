/**
 * Release notes, keyed by version.
 *
 * THE SPLIT. Versions and publish dates are NOT here: they are generated from
 * the registry into content/generated/releases.json by scripts/gen-releases.ts,
 * because the registry knows exactly when each version went out and a
 * hand-maintained list drifts from it silently on every publish. This file is
 * only the words, and the page joins the two. That is the same arrangement
 * content/agent-session.ts uses for the recorded run: facts generated, prose
 * written, and neither allowed to invent the other.
 *
 * THE RULE FOR ADDING ONE. A note is a transcription of what actually shipped,
 * traceable to the commit that shipped it. It is not a summary written later
 * from memory of what the version was probably about.
 *
 * Several versions have no note and that is not an oversight. `git log` is the
 * record for those and the page says so rather than filling the gap with
 * "various improvements", which is a sentence that means a release nobody can
 * describe. Adding a note to one of them is welcome; making one up is not.
 */
export interface ReleaseNote {
  /** One line, sentence case. What changed, not why it is exciting. */
  title: string;
  /** Two sentences at most. Optional. */
  body?: string;
  /** How a reader tells this apart at a glance. */
  kind: "feature" | "fix" | "chore";
}

export const RELEASE_NOTES: Record<string, ReleaseNote> = {
  "0.1.1": {
    kind: "feature",
    title: "Metered plans, an API-compatibility check, and the MIT relicense",
    body: "Stripe subscriptions with quotas the server actually enforces against the same plan table the pricing cards read. `lurq check-api` answers whether a change breaks the callers of your own service. The licence moved from Apache-2.0 to MIT.",
  },
  "0.0.10": {
    kind: "chore",
    title: "One source for the version",
    body: "The version string was being written in more than one place and could disagree with itself.",
  },
  "0.0.8": {
    kind: "chore",
    title: "Relicensed to Apache 2.0",
    body: "Since superseded by the move to MIT in 0.1.1.",
  },
  "0.0.7": {
    kind: "fix",
    title: "typescript is a runtime dependency, not a dev one",
    body: "Surface extraction reads shipped type declarations, so the compiler has to be present in an installed copy rather than only in the repo.",
  },
  "0.0.6": {
    kind: "feature",
    title: "Public launch: the pre-launch owner gate is lifted",
    body: "The CLI stopped requiring an owner key to run.",
  },
  "0.0.5": {
    kind: "fix",
    title: "Lazy-load the sandbox so startup cannot crash",
    body: "An ESM require of a transitive dependency was throwing before the CLI had parsed a single argument.",
  },
};

// ── page copy ────────────────────────────────────────────────────────────────

export const CHANGELOG_HEAD = "Every version, and the day the registry stamped it.";
export const CHANGELOG_LEAD =
  "The versions and dates below are read from the npm registry at build time, not typed. Notes are written by hand and only where the change is traceable to the commit that shipped it, so a release with no note here has one in the git log rather than a paragraph invented for this page.";

export const CHANGELOG_NO_NOTE = "No note recorded. See the commit history.";
