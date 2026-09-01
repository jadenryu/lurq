import Anthropic from "@anthropic-ai/sdk";
import { auth } from "@clerk/nextjs/server";
import { searchCapabilities } from "@lurq/core/capabilities";
import { loadRepos, loadRepo, loadUsage, loadAlerts } from "@/lib/dashboard-data";

/**
 * Ask a question about your own lurq data.
 *
 * This is deliberately NOT what the ⌘K palette already does. That searches a
 * 21-entry static catalog with weighted keyword matching, in-bundle, with no
 * network — and putting a model in front of it would be worse on every axis:
 * latency per keystroke, cost per keystroke, and it would break the property
 * that the catalog still answers while the API is down, which is exactly when
 * someone asks "what can lurq do". Worse, it could invent a capability. For a
 * product whose whole thesis is evidence over recall, a search box that
 * hallucinates a `lurq` command is a self-inflicted wound.
 *
 * What a model unlocks is the other question — the one no keyword matcher will
 * ever answer: "which repo is worst off", "what should I upgrade first", "am I
 * actually using this". Those need reasoning across repos, drift, advisories and
 * usage, and they are only answerable by reading the account's own data.
 *
 * So the rule this route enforces is the same one the product sells: the model
 * may not answer from recall. It has no knowledge of this account except what
 * the tools return, the tools are the same auth-scoped readers the dashboard
 * pages use, and the system prompt tells it to say it doesn't know rather than
 * guess. Grounded, not recalled.
 */

/** Streaming answers, so a multi-tool question doesn't sit on a blank box. */
export const dynamic = "force-dynamic";

/**
 * Tool inputs are model-generated, so every one is validated here rather than
 * trusted. `repoId` in particular indexes an account-scoped read — the reader
 * itself is scoped to the signed-in user, so a wrong id returns nothing rather
 * than someone else's repo, but a non-integer would reach the issuer as a
 * malformed path.
 */
function repoIdFrom(input: unknown): number | null {
  const raw = (input as { repoId?: unknown } | null)?.repoId;
  const id = typeof raw === "number" ? raw : Number(raw);
  return Number.isInteger(id) && id > 0 ? id : null;
}

const TOOLS: Anthropic.Tool[] = [
  {
    name: "list_repos",
    description:
      "Every repository this account has connected, with its drift summary: how many dependencies are declared, how many lurq has indexed, how many are behind by a major, how many are deprecated, and how many carry advisories. Start here for any question about which repo is worst off.",
    input_schema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "get_repo",
    description:
      "One repository in full: every declared dependency with its declared range, what a fresh install resolves to, the latest published version, majors behind, advisories, deprecation, and which manifest files declare it. Use after list_repos to explain WHY a repo scores badly.",
    input_schema: {
      type: "object",
      properties: {
        repoId: { type: "number", description: "The repo id from list_repos." },
      },
      required: ["repoId"],
      additionalProperties: false,
    },
  },
  {
    name: "get_usage",
    description:
      "This account's lurq call volume: per-day totals and a per-tool breakdown over the last N days. Use for questions about adoption, which tools are actually being used, or whether usage is growing.",
    input_schema: {
      type: "object",
      properties: {
        days: { type: "number", description: "Window in days, 1–365. Defaults to 30." },
      },
      additionalProperties: false,
    },
  },
  {
    name: "get_alerts",
    description:
      "Breaking releases detected for packages this account's repos depend on, including whether the declared range already admits the new major (meaning the next install picks it up on its own).",
    input_schema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "search_capabilities",
    description:
      "The catalog of what lurq itself can do — commands, MCP tools, and dashboard pages. Use for 'can lurq do X' questions. This is product metadata, not account data.",
    input_schema: {
      type: "object",
      properties: { query: { type: "string" } },
      required: ["query"],
      additionalProperties: false,
    },
  },
];

async function runTool(name: string, input: unknown): Promise<unknown> {
  switch (name) {
    case "list_repos": {
      const { data } = await loadRepos();
      return {
        configured: data.configured,
        repos: data.repos.map((r) => ({ id: r.id, fullName: r.fullName, drift: r.drift })),
      };
    }
    case "get_repo": {
      const id = repoIdFrom(input);
      if (id === null) return { error: "repoId must be a positive integer." };
      const { data } = await loadRepo(id);
      return data ?? { error: "No such repo on this account." };
    }
    case "get_usage": {
      const raw = (input as { days?: unknown } | null)?.days;
      const n = typeof raw === "number" ? raw : Number(raw);
      const days = Number.isFinite(n) ? Math.min(365, Math.max(1, Math.trunc(n))) : 30;
      const { data } = await loadUsage(days);
      return data;
    }
    case "get_alerts": {
      const { data } = await loadAlerts();
      return data;
    }
    case "search_capabilities": {
      const q = (input as { query?: unknown } | null)?.query;
      return searchCapabilities(typeof q === "string" ? q : "", 8);
    }
    default:
      return { error: `Unknown tool: ${name}` };
  }
}

const SYSTEM = `You answer questions about one lurq account, using only the tools provided.

lurq indexes JS/TS packages and watches the dependencies of repositories a user
has connected. Vocabulary you will meet in tool results:

- "declared" is what a manifest asks for (a range like ^6.4.0). "resolved" is the
  highest indexed version that range admits — what a fresh install gets today.
  "latest" is the newest published version. Drift is the gap between resolved and
  latest, NOT between the range's floor and latest.
- "tracked"/"indexed" dependencies are the ones lurq has data on. The rest are
  unknown, and unknown is never the same as fine. If a repo has 40 declared and 9
  indexed, you must say the answer covers 9 — do not present it as a clean bill.
- Advisories are recorded against a package, not proven against the installed
  version. Say "has had advisories", never "is vulnerable".

Rules:
- Answer only from tool results. You have no prior knowledge of this account.
- If the tools do not contain the answer, say so plainly and name what is missing.
  Never estimate, extrapolate, or fill a gap from general knowledge about a package.
- Cite concretely: name repos, packages and versions from the data.
- Be brief. Two or three sentences unless asked to go deeper. No preamble.
- When a next action exists, name the exact command or dashboard page.`;

export async function POST(req: Request) {
  const { userId } = await auth();
  if (!userId) return new Response("Unauthorized", { status: 401 });

  const apiKey = process.env.CLAUDE_API_KEY ?? process.env.ANTHROPIC_API_KEY;
  // A missing key is a deployment state, not a user error — say which, so the
  // palette can fall back to catalog search instead of showing a dead box.
  if (!apiKey) return new Response("Ask is not configured on this deployment.", { status: 503 });

  const body = (await req.json().catch(() => null)) as { question?: unknown } | null;
  const question = typeof body?.question === "string" ? body.question.trim() : "";
  if (!question) return new Response("A question is required.", { status: 400 });
  if (question.length > 500) return new Response("Question is too long.", { status: 400 });

  const client = new Anthropic({ apiKey });
  const messages: Anthropic.MessageParam[] = [{ role: "user", content: question }];

  const stream = new ReadableStream({
    async start(controller) {
      const send = (text: string) => controller.enqueue(new TextEncoder().encode(text));
      try {
        // Bounded turns. The loop is the model's, but the ceiling is ours: a
        // question that cannot be answered in this many reads is one the tools
        // do not cover, and spinning further just spends money to reach the
        // same "I don't know".
        for (let turn = 0; turn < 6; turn++) {
          const response = await client.messages.create({
            model: "claude-opus-5",
            max_tokens: 2048,
            // Low effort on purpose: this reads a handful of JSON blobs and
            // summarises them. It is not the workload that repays deep thinking,
            // and the box is meant to feel instant.
            output_config: { effort: "low" },
            system: SYSTEM,
            tools: TOOLS,
            messages,
          });

          for (const block of response.content) {
            if (block.type === "text" && block.text) send(block.text);
          }

          if (response.stop_reason !== "tool_use") break;

          messages.push({ role: "assistant", content: response.content });
          const results: Anthropic.ToolResultBlockParam[] = [];
          for (const block of response.content) {
            if (block.type !== "tool_use") continue;
            try {
              results.push({
                type: "tool_result",
                tool_use_id: block.id,
                content: JSON.stringify(await runTool(block.name, block.input)),
              });
            } catch (err) {
              // A failed read is reported back to the model, not thrown: it can
              // still answer from the tools that did work, and saying which part
              // is missing beats a blank error page.
              results.push({
                type: "tool_result",
                tool_use_id: block.id,
                is_error: true,
                content: err instanceof Error ? err.message : "Tool failed.",
              });
            }
          }
          // Every tool_result for one assistant turn goes back in a SINGLE user
          // message. Splitting them trains the model out of parallel calls.
          messages.push({ role: "user", content: results });
        }
      } catch (err) {
        const message =
          err instanceof Anthropic.RateLimitError
            ? "Rate limited — try again in a moment."
            : err instanceof Anthropic.APIError
              ? `The model service returned ${err.status}.`
              : "Could not reach the model service.";
        console.warn("[lurq] ask failed:", err instanceof Error ? err.message : String(err));
        send(`\n\n${message}`);
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" },
  });
}
