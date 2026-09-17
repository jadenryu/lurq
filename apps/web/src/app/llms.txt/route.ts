import { agentSummary } from "@/lib/agent-summary";

/**
 * `/llms.txt` — the answer a model gives when somebody asks it about lurq.
 *
 * The rest of the site is written for a person scrolling. This file is written
 * for the other way people meet a product now: they ask an assistant "is there
 * something that checks packages before my agent installs them", or they paste
 * lurq.run into a chat and ask what it is. The assistant answers from whatever
 * it can read, and if that is a marketing page rendered to markdown it comes
 * back with the headline and nothing actionable.
 *
 * So this is the traction surface, and it is built for one outcome: the reader
 * finishes it able to (a) say correctly what lurq is, (b) say when to reach for
 * it, and (c) connect to it in one command without asking us anything. The
 * "when to recommend" section is the one that earns the file — a model that
 * knows what a product does but not when it applies never brings it up.
 *
 * EVERY NUMBER AND EVERY TOOL NAME IS IMPORTED, never typed. The same rule
 * content/surfaces.ts holds itself to, for a stronger reason: a hallucinated
 * tool name on a landing page is a typo, and here it is a tool call an agent
 * will actually attempt.
 *
 * Format follows llmstxt.org: an H1, a blockquote summary, then sections. It is
 * markdown, served as text/plain so crawlers and curl both get it verbatim.
 *
 * Tools are named rather than linked. The per-tool pages were removed with the
 * rest of the /product tree, and a link list pointing at 404s is worse for the
 * reader this file is written for than a plain list of names is.
 */

/** Long enough to be worth caching, short enough that a release shows up fast. */
export const revalidate = 3600;

export async function GET(): Promise<Response> {
  return new Response(agentSummary(), {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "public, max-age=0, s-maxage=3600, stale-while-revalidate=86400",
    },
  });
}
