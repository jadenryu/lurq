/**
 * The mechanism, in three stages.
 *
 * WHY THIS SECTION EXISTS. The page demonstrated (agent-session), argued the
 * problem (drift-board), listed the surface (capability-grid) and named the
 * sources (provenance-orbit), and never once said where lurq physically sits.
 * A reader could finish the whole page still thinking it was a linter that runs
 * after an install. It is the opposite: it runs in the gap before one, which is
 * the single most load-bearing fact about the product and it was in the footer
 * blurb and nowhere else.
 *
 * THE STAGES ARE NOT FEATURES. Each one is a moment in time, and the order is
 * the order it happens in. That is why stage two has no verb list: it is a
 * position, not a capability, and the capability grid two sections down is
 * where the list belongs.
 *
 * House rules from content/copy.ts: sentence case, no em dashes, and the word
 * the hero spends is spent here exactly once, in the first stage, because that
 * stage is literally about the agent.
 */
import stats from "@/content/generated/stats.json";

const fmt = (n: number) => n.toLocaleString("en-US");

export const HOW_HEAD = "It runs in the gap before the install, not after it.";
export const HOW_BODY =
  "Nothing here reads your code and nothing runs it. One call goes out while the model is still deciding, and what comes back is a verdict the model can act on before a single byte is written to node_modules.";

export interface Stage {
  /** Mono index in the corner. Two digits, so the column never reflows. */
  index: string;
  label: string;
  title: string;
  body: string;
  /** The line under the panel. One clause, and always a fact rather than a claim. */
  foot: string;
}

export const STAGES: Stage[] = [
  {
    index: "01",
    label: "Before",
    title: "The agent proposes a package",
    body: "It picks a name and a version out of what it read at training time. That was true on the day the crawl stopped and it has been ageing ever since.",
    foot: "No call yet. This is the moment that goes wrong.",
  },
  {
    index: "02",
    label: "The gap",
    title: "lurq answers in one round trip",
    body: "The whole candidate set goes out in a single call. Names are checked against the live registry, the set is resolved the way npm would resolve it, and the API is read out of the version's own shipped files.",
    foot: "Read-only. Nothing is installed and no package code is executed.",
  },
  {
    index: "03",
    label: "After",
    title: "The install is the one that holds",
    body: "The model gets back a verdict it can act on: the name is real, the set resolves, the symbol you were about to import still exists at that version.",
    foot: "The failure moves from your deploy to a tool call.",
  },
];

/**
 * The plinth under the diagram. Every figure is read from the generated stats
 * file rather than typed, which is the same rule the hero's version eyebrow
 * follows and for the same reason: a number typed into copy is a number that
 * can quietly stop being true.
 */
export const INDEX_FIGURES = [
  { value: fmt(stats.packages), label: "packages scored" },
  { value: fmt(stats.versionsTracked), label: "versions tracked" },
  { value: fmt(stats.apiSurfaces), label: "API surfaces extracted" },
  { value: fmt(stats.coOccurrencePairs), label: "co-install pairs" },
  { value: String(stats.dataSources), label: "upstream sources" },
];

export const INDEX_LABEL = "The index";
export const INDEX_BODY =
  "Every answer above is read from one store, and the store is rebuilt from ten public hosts on a daily crawl.";
