import type { Database } from '../../db/client';
import type { BenchmarkCase, Participant, StackProposal } from '../types';
import { formatPrompt } from './prompt';
import { getConfig } from '../../core/config';
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
    type: 'function',
    function: {
      name: 'plan',
      description: 'Recommend the best packages for a list of component needs.',
      parameters: {
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
  },
  {
    type: 'function',
    function: {
      name: 'verify',
      description: 'Check if an npm package exists and gets its health score before selecting it.',
      parameters: {
        type: 'object',
        properties: {
          package: { type: 'string' },
        },
        required: ['package'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'compat',
      description:
        'Check if packages are compatible (peer deps + engines). Pass exact versions when known, and node when targeting a specific runtime.',
      parameters: {
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
  },
];

export class OpenAIWithLurqParticipant implements Participant {
  readonly kind = 'openai-with-lurq';

  constructor(
    public readonly id: string,
    public readonly model: string,
  ) {}

  async run(db: Database, benchCase: BenchmarkCase): Promise<StackProposal> {
    const config = getConfig();
    const key = config.SUMMARY_API_KEY || config.EMBEDDING_API_KEY;
    if (!key) throw new Error('No API key for OpenAI');

    const messages: any[] = [
      {
        role: 'user',
        content:
          formatPrompt(benchCase) +
          '\n\nYou have access to Lurq MCP tools. Use them to pick the best stack before emitting your final JSON.',
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
        reasoning_effort: 'none',
        temperature: 1,
        response_format: { type: 'json_object' },
      };
      if (!finalize) {
        body.tools = TOOLS;
      }

      const res = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${key}`,
        },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new Error(`OpenAI API error ${res.status}: ${text}`);
      }

      const data = (await res.json()) as any;
      const message = data.choices[0].message;
      messages.push(message);

      if (!finalize && message.tool_calls && message.tool_calls.length > 0) {
        for (const call of message.tool_calls) {
          try {
            const args = JSON.parse(call.function.arguments);
            let resultObj: any = null;

            if (call.function.name === 'plan') {
              resultObj = await handlePlan(db, { needs: args.needs });
            } else if (call.function.name === 'verify') {
              resultObj = await handleVerify(db, { package: args.package });
            } else if (call.function.name === 'compat') {
              resultObj = await handleCompat(db, {
                packages: args.packages,
                versions: args.versions,
                node: args.node ?? '20',
              });
            } else {
              resultObj = { error: 'Unknown tool' };
            }

            messages.push({
              role: 'tool',
              tool_call_id: call.id,
              name: call.function.name,
              content: JSON.stringify(resultObj),
            });
          } catch (e) {
            messages.push({
              role: 'tool',
              tool_call_id: call.id,
              name: call.function.name,
              content: JSON.stringify({ error: String(e) }),
            });
          }
        }
      } else if (message.content) {
        finalContent = message.content;
        break;
      } else if (finalize) {
        throw new Error('OpenAI finalize turn returned no content');
      }
    }

    if (!finalContent) throw new Error('Agent loop exhausted without emitting final JSON');

    try {
      return parseStackProposalJson(finalContent, 'model-with-lurq');
    } catch (err) {
      throw new Error(
        `Failed to parse final JSON: ${err instanceof Error ? err.message : String(err)}\nRaw response: ${finalContent}`,
      );
    }
  }
}
