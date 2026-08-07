/**
 * Every string the nav and the hero render.
 *
 * Casing rule: sentence case for anything a person reads. Lowercase survives
 * only where the data itself is lowercase: package names, commands, file
 * paths, version strings. `momnet` stays lowercase because that is its name.
 *
 * The version is read out of generated data rather than typed here, so the
 * eyebrow cannot drift from what is actually published.
 */
import stats from "@/content/generated/stats.json";

export const INSTALL_COMMAND = "npm i -g lurqrun";

/**
 * The copy affordance, kept out of the label. The visible text of a control has
 * to appear in its accessible name (WCAG 2.5.3), and a glyph nobody can
 * pronounce belongs in neither.
 */
export const COPY_GLYPH = "⧉";
export const COPY_HINT = "copy to clipboard";
export const COPIED_LABEL = "Copied";

// ── nav ──────────────────────────────────────────────────────────────────────

export const WORDMARK = "lurq";
/** Sits under the lockup in the footer. Says the category, not the pitch. */
export const BRAND_TAGLINE = "Verification for agent installs";
export const NAV_DOCS = "Docs";
export const NAV_CHANGELOG = "Changelog";
export const NAV_GITHUB = "GitHub";
export const NAV_SIGN_IN = "Sign in";
export const NAV_DASHBOARD = "Dashboard";
export const NAV_CTA = "Get started";

export const STATUS_UNREACHABLE = "api.lurq.run unreachable";
export const STATUS_PENDING_LABEL = "api.lurq.run status not yet known";
export const STATUS_OK_LABEL = "api.lurq.run responding";

// ── hero ─────────────────────────────────────────────────────────────────────

export const EYEBROW_VERSION = `v${stats.npm.latestVersion}`;
export const EYEBROW_NPM = "live on npm";
export const EYEBROW_LICENSE = "Apache-2.0";
export const NPM_PACKAGE_URL = "https://www.npmjs.com/package/lurqrun";

export const HEADLINE_LINE_1 = "The verification layer";
export const HEADLINE_LINE_2 = "for everything your agent installs.";

/**
 * One-line swaps. "Verification layer" is approved as the product category; a
 * specific pair is only ever `held` or `conflict`, never verified, because
 * nothing has been sandbox-executed.
 */
export const HEADLINE_ALTERNATES = [
  ["The verification layer", "your agent is missing."],
  ["Your agent picks the packages.", "lurq checks the consequences."],
  ["Every package your agent installs,", "checked before it ships."],
] as const;

/**
 * Two lines, 23 words. The four-clause version this replaces enumerated every
 * check and then conceded one of them, which took four lines to say less. The
 * concession now lives in NOTE_* below, where it is its own line rather than a
 * subordinate clause.
 */
export const LEAD =
  "An MCP server your agent calls before it installs, so the packages are real, the versions agree, and the stack runs where you deploy.";

/**
 * The qualifier, above the fold and at 12px. A claim the size of the headline
 * needs its limits visible without scrolling; it does not need them at the same
 * size as the claim.
 */
export const NOTE_BEFORE_LINK = "Three of the four checks work today. ";
export const NOTE_LINK = "See what doesn't ↓";

export const CTA_DOCS = "Read the docs";

// ── pair plate ───────────────────────────────────────────────────────────────

export const PANEL_TITLE = "compat";
/** Suffix on the plate's footer line; the date comes from the run itself. */
export const PANEL_FOOTER_SUFFIX = "read at request time";
/** Default caption under the grid, before anything is hovered or focused. */
export const PLATE_HINT = "hover a cell to name its pair";

// ── IDE section ──────────────────────────────────────────────────────────────

/**
 * A compatibility claim, not a customer claim. These are the clients that speak
 * MCP, not companies that pay us, so no count, no company logo, and never the
 * word "trusted".
 *
 * The labels are the point. Unlabelled glyphs make a reader squint; labelled
 * ones make a reader check whether theirs is on the list.
 */
export const IDE_HEADING = "One command. Every agent you already use.";
export const IDE_SUB = "lurq is an MCP server, so it installs where your agent looks for tools.";
export const IDE_COMMAND = "npx lurqrun install --agent <your-editor>";

// ── how it works ────────────────────────────────────────────────────

export const MCP_LABEL = "How it connects";
export const MCP_HEAD = "One command, then your agent just knows.";
export const MCP_BODY =
  "lurq is an MCP server, which is the standard way an editor hands its agent a new tool. Register it once and every agent in that editor can call it, without you changing how you work.";

export const MCP_STEPS = [
  {
    title: "Install it once",
    body: "One command registers lurq with your editor. Nothing else about your setup changes.",
  },
  {
    title: "Your agent picks it up",
    body: "The editor advertises lurq as an available tool, so the agent starts using it on its own when a question is about packages.",
  },
  {
    title: "It checks before it installs",
    body: "The call goes out to the registry, GitHub, advisory feeds and our own sandbox runs, and the answer comes back before anything lands in your project.",
  },
] as const;

// ── drift board ─────────────────────────────────────────────────────

/**
 * Every number this section prints comes from a single read-only query against
 * the index (scripts/gen-drift.ts). The one thing that is not measured is the
 * reference date, and the copy says so out loud rather than implying a precision
 * that does not exist.
 */
export const DRIFT_LABEL = "Drift leaderboard";
export const DRIFT_HEAD_1 = "The most-installed packages";
export const DRIFT_HEAD_2 = "your agent still gets wrong.";
export const DRIFT_BODY =
  "A new major version means the old API broke. Every package here shipped one after today's coding models finished training. Ask an agent which version to install and it answers with the crossed-out number, sounding certain.";

/**
 * The three summary stats and the footnote all name the reference date, and the
 * date lives in the generated data. Composed here rather than typed as prose so
 * a regenerated board with a different cutoff cannot leave the copy behind.
 */
export const DRIFT_STAT_SHARE = "of tracked packages have drifted";
export const driftStatDrifted = (since: string) => `shipped a new major since ${since}`;
export const DRIFT_STAT_TRACKED = "packages in the lurq index";
export const driftNote = (since: string) =>
  `Refreshed daily from lurq's own index. Nobody publishes exactly when a model stopped learning, so ${since} stands in for where today's coding models sit. Every other number on this board is measured.`;

// ── contact ─────────────────────────────────────────────────────────

export const CONTACT_LABEL = "Talk to us";
export const CONTACT_HEAD = "Tell us what your agent broke.";
export const CONTACT_BODY =
  "Bug reports, a package the index has wrong, or a stack you want checked before you ship it. It reaches a person, and the reply comes from the same address.";
export const CONTACT_EMAIL = "contact@lurq.run";
export const CONTACT_SUBMIT = "Send";
export const CONTACT_SENT = "Sent. We reply to the address you gave, usually within a day.";

// ── closing ─────────────────────────────────────────────────────────

/**
 * The last thing on the page, and the same argument the hero panel makes, said
 * as a sentence: a model's answer is a memory, and the memory has a date on it.
 */
export const CLOSING_LINE_1 = "Stop shipping what";
export const CLOSING_LINE_2 = "the model remembers.";
export const CLOSING_SUB =
  "Your agent already knows how to install packages. It just doesn't know what changed since it was trained.";

// ── footer ──────────────────────────────────────────────────────────

export const FOOTER_BLURB =
  "An MCP server your agent calls before it installs, so the packages are real, the versions agree, and the stack runs where you deploy.";
export const FOOTER_RIGHTS = `\u00a9 ${new Date().getFullYear()} lurq \u00b7 Apache-2.0`;
