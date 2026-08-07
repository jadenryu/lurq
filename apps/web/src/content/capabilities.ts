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
import type { ComponentType, SVGProps } from "react";
import { Activity, Blocks, Braces, Cpu, Layers, ShieldCheck } from "lucide-react";

export type Capability = {
  /** The question, in the words a developer would ask it. */
  title: string;
  body: string;
  /** The tool(s) that answer it today. Rendered, not just documented. */
  backedBy: string;
  icon: ComponentType<SVGProps<SVGSVGElement>>;
};

export const CAPABILITIES: Capability[] = [
  {
    title: "Is it real, and is it healthy?",
    body: "Whether the package exists at all, and what its downloads, release cadence, advisories and deprecations say. The guard against a name a model produced fluently and never checked.",
    backedBy: "verify · evaluate",
    icon: ShieldCheck,
  },
  {
    title: "Will these install together?",
    body: "Every pair in the set graded from declared peer ranges and from co-installs already recorded in the index, so you get the denominator too, not only the failures.",
    backedBy: "compat",
    icon: Blocks,
  },
  {
    title: "Does it run on your Node?",
    body: "Each package's declared engines range against the runtime you actually deploy on. A stack that resolves cleanly still breaks if one member never supported the Node you ship.",
    backedBy: "compat · usage",
    icon: Cpu,
  },
  {
    title: "What is the API, exactly?",
    body: "The exported symbols and signatures read out of the version's own shipped .d.ts. Pass the version your model remembers and get the delta: what moved, what went, what is new.",
    backedBy: "usage · resolve_surface · diff_surface",
    icon: Braces,
  },
  {
    title: "What should the whole stack be?",
    body: "Describe the project and get every slot sourced at once, checked across slots rather than one package at a time, so the pieces are chosen against each other.",
    backedBy: "recommend · plan",
    icon: Layers,
  },
  {
    title: "What happened after it shipped?",
    body: "Whether the pick installed clean, broke the build, or resolved the task. That signal exists nowhere but inside the decision, so it feeds back into the scoring.",
    backedBy: "report_outcome",
    icon: Activity,
  },
];

export const CAPABILITIES_LABEL = "What your agent can ask";

/**
 * The count is read off the list rather than typed, so a card added or dropped
 * cannot leave the headline claiming the old number.
 */
const COUNT = ["Zero", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight"][
  CAPABILITIES.length
] ?? String(CAPABILITIES.length);

export const CAPABILITIES_HEAD_1 = `${COUNT} questions your agent`;
export const CAPABILITIES_HEAD_2 = "cannot answer on its own.";
export const CAPABILITIES_BODY =
  "Every answer is read at request time from the index, the registry, or the package's own shipped types. Where lurq cannot answer, it says so rather than filling the gap.";
