import type { Database } from '../../db/client';
import type { BenchmarkCase, Participant, StackProposal } from '../types';
import { formatPrompt } from './prompt';
import { handlePlan } from '../../mcp/plan';
import { handleVerify, handleCompat } from '../../mcp/handlers';
import {
  FINALIZE_NUDGE,
  WITH_LURQ_MAX_ITERATIONS,
  isFinalAgentTurn,
  parseStackProposalJson,
} from './agentLoop';

const TOOLS = [
  {
    name: 'plan',
    description: 'Recommend the best packages for a list of component needs.',
    input_schema: {
      type: 'object',
      properties: {
        needs: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              need: { type: 'string' },
              category: { type: 'string' },
            },
            required: ['need'],
          },
        },
      },
    },
  },
  {
    name: 'verify',
    description: 'Check if an npm package exists and gets its health score before selecting it.',
    input_schema: {
      type: 'object',
      properties: {
        package: { type: 'string' },
      },
      required: ['package'],
    },
  },
  {
    name: 'compat',
    description:
      'Check if packages are compatible (peer deps + engines). Pass exact versions when known, and node when targeting a specific runtime.',
    input_schema: {
      type: 'object',
      properties: {
        packages: {
          type: 'array',
          items: { type: 'string' },
        },
        versions: {
          type: 'object',
          additionalProperties: { type: 'string' },
          description: 'Optional exact versions keyed by package name',
        },
        node: {
          type: 'string',
          description: 'Optional target Node version (e.g. "20" or "20.20.2")',
        },
      },
      required: ['packages'],
    },
  },
];

export class AnthropicWithLurqParticipant implements Participant {
  readonly kind = 'anthropic-with-lurq';

  constructor(
    public readonly id: string,
    public readonly model: string,
  ) {}

  async run(db: Database, benchCase: BenchmarkCase): Promise<StackProposal> {
    const key = process.env.CLAUDE_API_KEY;
    if (!key) throw new Error(`Participant ${this.id} requires CLAUDE_API_KEY in .env`);

    const messages: any[] = [
      {
        role: 'user',
        content:
          formatPrompt(benchCase) +
          '\n\nYou have access to Lurq MCP tools. Use them to pick the best stack before emitting your final JSON wrapped in a ```json markdown block.',
      },
    ];

    let finalContent: string | null = null;
    let iterations = 0;

    while (iterations < WITH_LURQ_MAX_ITERATIONS) {
      iterations++;
      const finalize = isFinalAgentTurn(iterations);

      if (finalize) {
        messages.push({ role: 'user', content: FINALIZE_NUDGE });
      }

      const body: Record<string, unknown> = {
        model: this.model,
        messages,
        max_tokens: 8192,
      };
      if (!finalize) {
        body.tools = TOOLS;
      }

      const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': key,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new Error(`Anthropic API error ${res.status}: ${text}`);
      }

      const data = (await res.json()) as any;
      messages.push({ role: 'assistant', content: data.content });

      const toolCalls = (data.content ?? []).filter((c: any) => c.type === 'tool_use');

      if (!finalize && toolCalls.length > 0) {
        const toolResults = [];
        for (const call of toolCalls) {
          try {
            const args = call.input;
            let resultObj: any = null;

            if (call.name === 'plan') {
              resultObj = await handlePlan(db, { needs: args.needs });
            } else if (call.name === 'verify') {
              resultObj = await handleVerify(db, { package: args.package });
            } else if (call.name === 'compat') {
              resultObj = await handleCompat(db, {
                packages: args.packages,
                versions: args.versions,
                node: args.node ?? '20',
              });
            } else {
              resultObj = { error: 'Unknown tool' };
            }

            toolResults.push({
              type: 'tool_result',
              tool_use_id: call.id,
              content: JSON.stringify(resultObj),
            });
          } catch (e) {
            toolResults.push({
              type: 'tool_result',
              tool_use_id: call.id,
              content: JSON.stringify({ error: String(e) }),
              is_error: true,
            });
          }
        }

        messages.push({
          role: 'user',
          content: toolResults,
        });
      } else {
        const textContent = (data.content ?? [])
          .filter((c: any) => c.type === 'text')
          .map((c: any) => c.text)
          .join('');
        if (textContent) {
          finalContent = textContent;
          break;
        }
        if (finalize) {
          throw new Error('Anthropic finalize turn returned no text content');
        }
        throw new Error('Anthropic returned no text content and no tool calls');
      }
    }

    if (!finalContent) throw new Error('Agent loop exhausted without emitting final JSON');

    try {
      return parseStackProposalJson(finalContent, 'model-with-lurq');
    } catch (err) {
      throw new Error(
        `Failed to parse Anthropic JSON response: ${err instanceof Error ? err.message : String(err)}\nRaw response: ${finalContent}`,
      );
    }
  }
}
