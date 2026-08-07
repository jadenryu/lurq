import { faqs } from "@/content/faq";

/**
 * The existing FAQ list, grouped for the left-heading layout.
 *
 * The questions and answers themselves live in content/faq.ts and are not
 * rewritten here: this file only says which group each one belongs to, by
 * matching on the question text. If a question is edited there and the match
 * breaks, the build fails below rather than the item silently vanishing from the
 * page.
 */
export type FaqGroup = {
  id: string;
  title: string;
  items: { q: string; a: string }[];
};

const GROUPING: { id: string; title: string; questions: string[] }[] = [
  {
    id: "general",
    title: "General",
    questions: [
      "What is lurq?",
      "How is it different from just asking my model?",
      "Which tools does it work with?",
      /* The hero's qualifier line points at this. It sits in the first group,
         not buried in the last one, because a limits answer a reader has to hunt
         for is not really a disclosure. */
      "What doesn't work yet?",
    ],
  },
  {
    id: "checks",
    title: "The checks",
    questions: [
      "What do you mean by execution-verified?",
      "Why does a whole stack need checking, not just each package?",
    ],
  },
  {
    id: "data",
    title: "Data and access",
    // "Where does the data come from?" was here and its answer has been deleted
    // from faq.ts. The guard below is what caught that: the grouping matches on
    // question text, so a question that goes away takes the page down at build
    // rather than quietly dropping out of the list. #sources answers it now.
    questions: ["How current is it?", "Is it free?"],
  },
];

const BY_QUESTION = new Map(faqs.map((f) => [f.q, f]));

export const FAQ_GROUPS: FaqGroup[] = GROUPING.map((g) => ({
  id: g.id,
  title: g.title,
  items: g.questions.map((q) => {
    const hit = BY_QUESTION.get(q);
    if (!hit) {
      throw new Error(
        `faq-groups: no question in content/faq.ts matches "${q}". Update the grouping.`,
      );
    }
    return hit;
  }),
}));

export const FAQ_HEAD = "Questions, answered.";
export const FAQ_CONTACT_BEFORE = "Something not covered here?";
export const FAQ_CONTACT_LINK = "Talk to us";
