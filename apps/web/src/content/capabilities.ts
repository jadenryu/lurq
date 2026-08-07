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
};

/**
 * Bodies rewritten for rhythm, not for content: every claim is the one that was
 * here before. Four of the five closed on a "not X, only Y" clause, which is a
 * shape that stops registering by the third card, and all five ran to the same
 * two-sentence length. They now vary, and the one short body is deliberate.
 */
export const CAPABILITIES: Capability[] = [
  {
    title: "Is it real, and is it healthy?",
    body: "Downloads, release cadence, open advisories, deprecation flags. Mostly this catches the package that does not exist: a name the model produced fluently, spelled the way a real one would be spelled.",
    backedBy: "verify · evaluate",
    figure: "health",
  },
  {
    title: "Will these install together?",
    body: "Every pair in the set, graded against declared peer ranges and against co-installs already sitting in the index. You get the denominator with the failures, so a clean result means something.",
    backedBy: "compat",
    figure: "pairs",
  },
  {
    title: "Does it run on your Node?",
    body: "Each declared engines range, checked against the runtime you actually deploy on. A stack can resolve perfectly and still die on boot because one member never supported the Node you ship.",
    backedBy: "compat · usage",
    figure: "engines",
  },
  {
    title: "What is the API, exactly?",
    body: "Exported symbols and signatures, read out of the version's own shipped .d.ts. Hand it the version your model remembers and it returns the delta: what moved, what went, what is new.",
    backedBy: "usage · resolve_surface · diff_surface",
    figure: "surface",
  },
  {
    title: "What should the whole stack be?",
    body: "Describe the project, get every slot filled at once. The pieces are picked against each other rather than one at a time, which is the only way the set holds.",
    backedBy: "recommend · plan",
    figure: "stack",
  },
];

/**
 * `report_outcome` had a sixth card and lost it. Five is the lineup that was
 * actually asked for, and the bento wants five: two wide, three narrow. A sixth
 * forced a uniform 3x2, which is the grid this section is moving away from.
 * The tool is still live and still in the docs; it just isn't a headline.
 */

/**
 * A label and one sentence, and that is the whole introduction.
 *
 * This section used to open with an eyebrow, a two-line headline and a
 * three-line paragraph, which is more preamble than the five cards underneath
 * it need — each one already states its own question. The paragraph in
 * particular was explaining what the cards then demonstrate.
 */
export const CAPABILITIES_LABEL = "The tools";

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
