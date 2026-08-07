/**
 * Every string the nav and the hero render.
 *
 * Casing rule: sentence case for anything a person reads. Lowercase survives
 * only where the data itself is lowercase: package names, commands, file
 * paths, version strings. `momnet` stays lowercase because that is its name.
 *
 * The version is read out of generated data rather than typed here, so the
 * eyebrow cannot drift from what is actually published.
 *
 * TWO WRITING RULES, added after a read-through of the whole page.
 *
 * 1. NO EM DASHES. Anywhere a reader can see. Colon, comma, or a full stop.
 *
 * 2. THE WORD "AGENT" BELONGS TO THE HERO. The headline and the lead spend it,
 *    and after that the page has to find other nouns: the model, your editor,
 *    the tool, you. Six sections in a row opening with "your agent" is the tell
 *    that nobody read them in sequence. Grep before adding one:
 *    `grep -c agent content/*.ts` should stay in single digits outside the hero.
 *
 * Alongside those: vary the sentence lengths, and do not write three sections
 * in the same clause shape. "X, not Y" and "A, B, and C" are both fine once and
 * turn mechanical by the third repeat.
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
 * Two lines, 23 words. The four-clause version this replaces enumerated every
 * check and then conceded one of them, which took four lines to say less. The
 * concession now lives in NOTE_* below, where it is its own line rather than a
 * subordinate clause.
 */
export const LEAD =
  "lurq serves your agent before it ever installs a single package, so the versions agree and the stack runs when you deploy.";

/* THE HERO NOTE IS GONE. It went through three versions and none of them earned
   the line. "Three of the four checks work today" put a four on the page while
   #tools said five. "Some of it is still rough. The questions below say which
   parts" replaced a concrete number with a vague admission and a pointer, which
   is a worse trade: it asks the reader to go looking without telling them what
   for. The limits are answered properly in the FAQ, under "What doesn't work
   yet?", and that is where a reader who cares will find them. A hedge under the
   install button was only ever protecting us. */

export const CTA_DOCS = "Read the docs";

// ── IDE section ──────────────────────────────────────────────────────────────

/**
 * A compatibility claim, not a customer claim. These are the clients that speak
 * MCP, not companies that pay us, so no count, no company logo, and never the
 * word "trusted".
 *
 * The labels are the point. Unlabelled glyphs make a reader squint; labelled
 * ones make a reader check whether theirs is on the list.
 *
 * Reads late on the page now rather than second. After the tools and the sources
 * it means "and it runs in yours". Straight after the hero it was an install
 * guide for a product the reader had not been shown yet.
 */
export const IDE_HEADING = "Install it once. It shows up in all of these.";

/* The "how it connects" copy that used to sit here (MCP_LABEL, MCP_HEAD,
   MCP_BODY, MCP_STEPS, IDE_COMMAND) is gone. It was written for a section that
   was never built and was rendered nowhere, so it read as live copy to anyone
   editing this file while the page stayed silent on how to install anything.
   content/surfaces.ts is where that section's strings live now. */

// ── drift board ─────────────────────────────────────────────────────

/**
 * Every number this section prints comes from a read-only query against the index
 * (scripts/gen-drift.ts), measured against a date the model's own vendor
 * published. Nothing here is our estimate, which is why the footnote can now name
 * the source instead of apologising for approximating it.
 */
export const DRIFT_HEAD_1 = "The most-installed packages";
/** "model", not "agent": it is the training cutoff that causes this, not the tool. */
export const DRIFT_HEAD_2 = "your model still gets wrong.";
export const DRIFT_BODY =
  "New versions mean the old API broke. We record the date their knowledge stops and record how the registry transforms over time. Asking models which version to install returns confident answers but breaking code";


/** The picker, and the sentence it produces. */
export const DRIFT_PICKER_LABEL = "Knowledge cutoff";
export const driftClaim = (model: string) => `${model} stopped learning in`;

/**
 * The summary stats and the footnote all name the selected model's cutoff, and
 * that date lives in the generated data. Composed here rather than typed as prose
 * so switching models cannot leave the copy behind.
 */
/**
 * A function, like its two siblings below, because it names the cutoff.
 *
 * It was a bare constant ending in "since", and the date it wanted was never
 * appended: the card rendered "10% / of the packages it knew have broken since"
 * with nothing after it. The comment above already said these are "composed
 * here rather than typed as prose" so a regenerated board cannot leave the copy
 * behind; this one had been left out of that rule.
 */
export const driftStatShare = (since: string) =>
  `of the packages it knew have broken since ${since}`;
export const driftStatDrifted = (since: string) => `shipped a new major upgrade after ${since}`;
export const DRIFT_STAT_TRACKED = "packages the index already tracked by then";
/**
 * The read date, not a cadence.
 *
 * This footnote used to open "Refreshed daily from lurq's own index." Nothing
 * generates that claim and stats.json contradicts it: the last sync came back
 * `partial` having seen 295 of 3,315 packages. A date the pipeline actually
 * stamped is both true and the thing a reader wanted anyway.
 */
const READ_ON = new Date(stats.dataAsOf).toLocaleDateString("en-GB", {
  day: "numeric",
  month: "short",
  year: "numeric",
  timeZone: "UTC",
});

export const driftNote = (model: string, vendor: string, since: string) =>
  `Read from lurq's own index on ${READ_ON}. The ${since} cutoff is ${vendor}'s published figure for ${model}. Totals count only packages the index already tracked by that date, and every number here is measured against it.`;

// ── contact ─────────────────────────────────────────────────────────

export const CONTACT_HEAD = "Tell us what broke.";
export const CONTACT_BODY =
  "A bug, a package we have scored wrong, a stack you want a second opinion on. There is no ticket queue. It lands in an inbox one of us reads.";
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
  "The model already knows how to install packages. What it doesn't know is what shipped after it stopped reading.";

// ── footer ──────────────────────────────────────────────────────────

/**
 * Not the lead again. This was LEAD copied word for word, sitting directly under
 * BRAND_TAGLINE, which already names the category. Three restatements stacked in
 * one column, and the third one was 23 words long.
 */
export const FOOTER_BLURB = "One call, in the gap between the suggestion and the install.";
export const FOOTER_RIGHTS = `\u00a9 ${new Date().getFullYear()} lurq \u00b7 Apache-2.0`;
