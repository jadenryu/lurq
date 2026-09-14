import { agentSummary } from "@/lib/agent-summary";

/**
 * `/index.md`: the homepage as markdown, for agents that fetch pages.
 *
 * The homepage is a designed page, and an agent reading its HTML gets the
 * headline and a lot of layout. This is the same facts in the shape an agent
 * parses well, advertised from the homepage with
 * `<link rel="alternate" type="text/markdown">`. It is the /llms.txt body on
 * purpose: one source, so the two alternates cannot disagree, and neither can
 * say anything the site does not.
 */
export const revalidate = 3600;

export async function GET(): Promise<Response> {
  return new Response(agentSummary(), {
    headers: {
      "Content-Type": "text/markdown; charset=utf-8",
      "Cache-Control": "public, max-age=0, s-maxage=3600, stale-while-revalidate=86400",
    },
  });
}
