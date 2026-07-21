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
    functionDeclarations: [
      {
        name: 'plan',
        description: 'Recommend the best packages for a list of component needs.',
        parameters: {
          type: 'OBJECT',
          properties: {
            needs: {
              type: 'ARRAY',
              items: {
                type: 'OBJECT',
                properties: {
                  need: { type: 'STRING' },
                  category: { type: 'STRING' },
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
        parameters: {
          type: 'OBJECT',
          properties: {
            package: { type: 'STRING' },
          },
          required: ['package'],
        },
      },
      {
        name: 'compat',
        description:
          'Check if packages are compatible (peer deps + engines). Pass exact versions when known, and node when targeting a specific runtime.',
        parameters: {
          type: 'OBJECT',
          properties: {
            packages: {
              type: 'ARRAY',
              items: { type: 'STRING' },
            },
            versions: {
              type: 'OBJECT',
              description: 'Optional exact versions keyed by package name',
            },
            node: {
              type: 'STRING',
              description: 'Optional target Node version (e.g. "20" or "20.20.2")',
            },
          },
          required: ['packages'],
        },
      },
    ],
  },
];

export class GeminiWithLurqParticipant implements Participant {
  readonly kind = 'gemini-with-lurq';

  constructor(
    public readonly id: string,
    public readonly model: string,
  ) {}

  async run(db: Database, benchCase: BenchmarkCase): Promise<StackProposal> {
    const key = process.env.GEMINI_API_KEY;
    if (!key) throw new Error(`Participant ${this.id} requires GEMINI_API_KEY in .env`);

    const contents: any[] = [
      {
        role: 'user',
        parts: [
          {
            text:
              formatPrompt(benchCase) +
              '\n\nYou have access to Lurq MCP tools. Use them to pick the best stack before emitting your final JSON.',
          },
        ],
      },
    ];

    let finalContent: string | null = null;
    let iterations = 0;
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${this.model}:generateContent?key=${key}`;

    while (iterations < WITH_LURQ_MAX_ITERATIONS) {
      iterations++;
      const finalize = isFinalAgentTurn(iterations);

      if (finalize) {
        contents.push({ role: 'user', parts: [{ text: FINALIZE_NUDGE }] });
      }

      const body: Record<string, unknown> = { contents };
      if (!finalize) {
        body.tools = TOOLS;
      } else {
        body.generationConfig = { responseMimeType: 'application/json' };
      }

      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new Error(`Gemini API error ${res.status}: ${text}`);
      }

      const data = (await res.json()) as any;
      const candidate = data.candidates?.[0];
      if (!candidate) {
        throw new Error('Gemini returned no candidates');
      }
      const parts = candidate.content?.parts;
      if (!parts) {
        throw new Error('Gemini candidate has no parts');
      }

      contents.push({ role: 'model', parts });

      const toolCalls = parts.filter((p: any) => p.functionCall);

      if (!finalize && toolCalls.length > 0) {
        const functionResponses = [];
        for (const callPart of toolCalls) {
          const call = callPart.functionCall;
          try {
            const args = call.args;
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

            functionResponses.push({
              functionResponse: {
                name: call.name,
                response: resultObj,
              },
            });
          } catch (e) {
            functionResponses.push({
              functionResponse: {
                name: call.name,
                response: { error: String(e) },
              },
            });
          }
        }

        contents.push({
          role: 'user',
          parts: functionResponses,
        });
      } else {
        const textContent = parts
          .map((p: any) => p.text)
          .filter((t: unknown) => typeof t === 'string' && t.trim())
          .join('');
        if (textContent) {
          finalContent = textContent;
          break;
        }
        if (finalize) {
          throw new Error('Gemini finalize turn returned no text content');
        }
        throw new Error('Gemini returned no text content and no tool calls');
      }
    }

    if (!finalContent) throw new Error('Agent loop exhausted without emitting final JSON');

    try {
      return parseStackProposalJson(finalContent, 'model-with-lurq');
    } catch (err) {
      throw new Error(
        `Failed to parse Gemini JSON response: ${err instanceof Error ? err.message : String(err)}\nRaw response: ${finalContent}`,
      );
    }
  }
}
