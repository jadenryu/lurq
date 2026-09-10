/**
 * What an agent can ask lurq, as questions rather than as tool names.
 *
 * WHY QUESTIONS. The tool lineup is mid-change: verify, evaluate and compat are
 * being merged, and the engines check is being promoted out of compat into a
 * tool of its own. Naming the cards after tools would put two names on the page
 * that an agent cannot call yet, on a page whose hero says "Three of the four
 * checks work today". Naming them after the question each one answers is true
 * now, stays true through the merge, and needs no "planned" badge.
 *
 * Every `backedBy` below runs today. It is the receipt for the card above it and
 * the thing to re-check before editing a card: if a capability ever stops being
 * live, the card is a lie regardless of how it is worded.
 */
import type { FigureName } from "@/components/site/capability-figures";

export type Capability = {
  /** The question, in the words a developer would ask it. */
  title: string;
  body: string;
  /** The tool(s) that answer it today. Rendered, not just documented. */
  backedBy: string;
  /**
   * Which figure draws this check. Not an icon: see capability-figures.tsx for
   * why a padlock and a chip were the wrong furniture for this page.
   */
  figure: FigureName;
  /** The call on the back of the card. See {@link Call}. */
  call: Call;
};

/**
 * The back of a card: the call an agent actually makes to answer that question.
 *
 * EVERY `tool` HERE IS REGISTERED IN src/mcp/server.ts TODAY, and every `body`
 * validates against that tool's zod schema. This is the same rule content/
 * surfaces.ts holds itself to, and it matters more here than on a decorative
 * terminal, because this panel has a copy button: a wrong argument name is not a
 * typo on a page, it is a call somebody pastes into their editor that fails.
 *
 * FOUR CARDS, FOUR DIFFERENT TOOLS, and that is a constraint rather than a
 * coincidence. Two of these cards pointed at `compat`, which made the section
 * argue that lurq does two things twice. The Node question moved to `usage`,
 * which returns the version's declared engines and is the honest answer to it,
 * and that pushed the API question onto `diff_surface`, which is the tool that
 * actually produces the delta the card's own body promises. Everything reads
 * better and nothing had to be invented.
 *
 * Written per card rather than borrowed from content/tools.ts: a tool's own
 * example answers the tool's headline question, not the one a card is asking.
 *
 * `note` is what the panel says under the call. One line, present tense, and it
 * describes what comes back rather than restating the question.
 */
export type Call = {
  /** Registered MCP tool name. Rendered as the terminal's own prompt. */
  tool: string;
  /** Request body, pretty-printed, exactly as an agent would send it. */
  body: string;
  note: string;
};

/**
 * Bodies rewritten for rhythm, not for content: every claim is the one that was
 * here before. They all closed on a "not X, only Y" clause, which is a shape
 * that stops registering by the third card, and all ran to the same
 * two-sentence length. They now vary.
 */
export const CAPABILITIES: Capability[] = [
  {
    title: "Is it real, and is it healthy?",
    body: "Downloads, release cadence, open advisories, deprecation flags. We catch the package that does not exist: a name the model produced fluently, spelled the way a real one would be spelled.",
    backedBy: "verify · evaluate",
    figure: "health",
    call: {
      tool: "verify",
      body: `{
  "package": "reqeusts"
}`,
      note: "Comes back with exists: false, and the real name it is one edit away from.",
    },
  },
  {
    title: "Will these install together?",
    body: "Every pair in the set, graded against declared peer ranges and co-installs already in the compatibility matrix.",
    backedBy: "compat",
    figure: "pairs",
    call: {
      tool: "compat",
      body: `{
  "packages": ["next", "react", "react-dom"],
  "versions": { "react": "19.2.0" }
}`,
      note: "Every pair graded against declared peer ranges and co-installs already seen.",
    },
  },
  {
    title: "Does it run on your Node?",
    body: "We check against the runtime you deploy on. Declared engines can range, so stacks can resolve perfectly and still die in production because one node doesn't support the Node you ship.",
    backedBy: "compat · usage",
    figure: "engines",
    call: {
      tool: "usage",
      body: `{
  "package": "sharp",
  "version": "0.34.4"
}`,
      note: "Returns the version's declared engines, so its Node floor is read rather than assumed.",
    },
  },
  {
    title: "What is the API, exactly?",
    body: "Exported symbols and signatures, read out of the version's own shipped .d.ts. We hand the delta to your model: what moved, what went, what is new.",
    backedBy: "usage · resolve_surface · diff_surface",
    figure: "surface",
    call: {
      tool: "diff_surface",
      body: `{
  "package": "zod",
  "fromVersion": "3.23.8",
  "toVersion": "4.1.12"
}`,
      note: "Symbols removed, added and changed between the two, read from shipped JavaScript.",
    },
  },
];

/**
 * TWO CARDS HAVE BEEN CUT, and the second one is the interesting deletion.
 *
 * `report_outcome` went first: it is live and it is in the docs, it is just not
 * a headline.
 *
 * "What should the whole stack be?" went second, and it went because the back of
 * a card is a harder test than the front. Its `backedBy` read `recommend · plan`
 * and neither is registered on the MCP server: both were shelved. The card had
 * survived a long time as prose, because prose can describe a capability that
 * does not answer a call. The moment every card had to print the call an agent
 * makes, the one card with no call to print had nowhere to hide.
 *
 * Bring it back when `recommend` ships, with its own call. Do not bring it back
 * pointing at a neighbouring tool: that is how the front of a card starts
 * claiming something the back cannot demonstrate.
 */

/**
 * A label and one sentence, and that is the whole introduction.
 *
 * This section used to open with an eyebrow, a two-line headline and a
 * three-line paragraph, which is more preamble than the five cards underneath
 * it need: each one already states its own question. The paragraph in
 * particular was explaining what the cards then demonstrate.
 */

/**
 * The count is read off the list rather than typed, so a card added or dropped
 * cannot leave the headline claiming the old number.
 */
const COUNT = ["Zero", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight"][
  CAPABILITIES.length
] ?? String(CAPABILITIES.length);

/**
 * "A model", not "your agent". The hero has already spent that word twice and
 * every section between here and it was reaching for it again. The cause is the
 * training cutoff anyway, which belongs to the model rather than to the tool
 * calling it.
 */
export const CAPABILITIES_HEAD = `${COUNT} questions a model cannot answer from memory.`;
