/**
 * The hero artifact's content: what a coding agent answers from training data,
 * beside what lurq answers from live data.
 *
 * STATIC ON PURPOSE. This file is hand-maintained and is not generated from a
 * run. See content/hero-run.json for the generated artifact. That distinction
 * matters, because the panel that renders this is an *illustration of how the
 * product behaves*, not a receipt for a run that happened. It is labelled that
 * way on the page and must stay labelled that way: the moment it claims to be a
 * live check, every number in it becomes a lie.
 *
 * Provenance of each row, so a future edit knows what it is allowed to change:
 *   1. real   : both facts came out of `lurq compat` on 6 Aug 2026 and are in
 *               content/hero-run.json. next resolved to 16.3.0.
 *   2. real   : same run: next-auth@4.24.15 declares peer @auth/core@0.34.3
 *               while the stack resolves 0.41.3.
 *   3. real   : same run: @typescript-eslint/eslint-plugin@8.66.0 declares peer
 *               typescript >=4.8.4 <6.1.0 against a stack on 7.0.2.
 *   4. staged : the name is invented so this page never points a typosquat
 *               accusation at a real package. The *shape* is real: lurq scores
 *               edit distance against high-download names and weighs age and
 *               download count. Keep it invented.
 *
 * The left column is written the way a model actually answers: fluent, specific,
 * and stated without hedging. That is the argument. It is not wrong because it
 * is careless. It is wrong because its training data has a date on it.
 */

export type SplitRow = {
  /** What the agent was asked to install. */
  request: string;
  /** The unaided answer: confident, and frozen at training time. */
  model: string;
  /** What lurq returns, read at request time. */
  verdict: "held" | "conflict";
  /** First line of the verdict: the finding. */
  finding: string;
  /** Second line: the evidence behind it. */
  evidence: string;
};

export const SPLIT_ROWS: SplitRow[] = [
  {
    request: "next",
    model: "Latest is 15.1.6.",
    verdict: "held",
    finding: "16.3.0 is current",
    evidence: "two majors on from the model's answer",
  },
  {
    request: "next-auth@4.24.15",
    model: "Pairs fine with @auth/core.",
    verdict: "conflict",
    finding: "declares peer @auth/core@0.34.3",
    evidence: "your stack resolves 0.41.3",
  },
  {
    request: "@typescript-eslint/eslint-plugin@8.66.0",
    model: "Works with your TypeScript.",
    verdict: "conflict",
    finding: "declares peer typescript >=4.8.4 <6.1.0",
    evidence: "your stack resolves 7.0.2",
  },
  {
    request: "requsts",
    model: "Installing requsts.",
    verdict: "conflict",
    finding: "not a package. 1 edit from `requests`",
    evidence: "9 downloads, published 4 days ago",
  },
];

export const SPLIT_LEFT_TITLE = "the agent, unaided";
export const SPLIT_RIGHT_TITLE = "the agent, with lurq";
/**
 * The left column's provenance, said out loud. A model's answer is not a guess,
 * it is a memory, and the memory has a date.
 */
export const SPLIT_LEFT_NOTE = "answered from training data";
export const SPLIT_RIGHT_NOTE = "read at request time";
/** Says what the panel is, so it is never mistaken for a live run. */
export const SPLIT_CAPTION = "An example of a single install request. lurq returns the right-hand column.";
