import type { Database } from '../../db/client';
import type { BenchmarkCase, Participant, StackProposal } from '../types';
import { formatPrompt } from './prompt';
import { getConfig } from '../../core/config';
import { handlePlan } from '../../mcp/plan';
import { handleVerify, handleCompat } from '../../mcp/handlers';

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
                category: { type: 'string' }
              },
              required: ['need']
            }
          }
        }
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'verify',
      description: 'Check if an npm package exists and gets its health score before selecting it.',
      parameters: {
        type: 'object',
        properties: {
          package: { type: 'string' }
        },
        required: ['package']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'compat',
      description: 'Check if a list of packages are compatible with each other.',
      parameters: {
        type: 'object',
        properties: {
          packages: {
            type: 'array',
            items: { type: 'string' }
          }
        },
        required: ['packages']
      }
    }
  }
];

export class OpenAIWithLurqParticipant implements Participant {
  readonly kind = 'openai-with-lurq';

  constructor(
    public readonly id: string,
    public readonly model: string
  ) {}

  async run(db: Database, benchCase: BenchmarkCase): Promise<StackProposal> {
    const config = getConfig();
    const key = config.SUMMARY_API_KEY || config.EMBEDDING_API_KEY;
    if (!key) throw new Error('No API key for OpenAI');

    const messages: any[] = [
      { role: 'user', content: formatPrompt(benchCase) + '\n\nYou have access to Lurq MCP tools. Use them to pick the best stack before emitting your final JSON.' }
    ];

    let finalContent: string | null = null;
    let iterations = 0;

    while (iterations < 5) {
      iterations++;
      
      const res = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${key}`,
        },
        body: JSON.stringify({
          model: this.model,
          messages,
          reasoning_effort: 'none',
          temperature: 1,
          tools: TOOLS,
          response_format: { type: 'json_object' }
        }),
      });

      if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new Error(`OpenAI API error ${res.status}: ${text}`);
      }

      const data = await res.json() as any;
      const message = data.choices[0].message;
      messages.push(message);

      if (message.tool_calls && message.tool_calls.length > 0) {
        for (const call of message.tool_calls) {
          try {
            const args = JSON.parse(call.function.arguments);
            let resultObj: any = null;

            if (call.function.name === 'plan') {
              resultObj = await handlePlan(db, { needs: args.needs });
            } else if (call.function.name === 'verify') {
              resultObj = await handleVerify(db, { package: args.package });
            } else if (call.function.name === 'compat') {
              resultObj = await handleCompat(db, { packages: args.packages });
            } else {
              resultObj = { error: 'Unknown tool' };
            }

            messages.push({
              role: 'tool',
              tool_call_id: call.id,
              name: call.function.name,
              content: JSON.stringify(resultObj)
            });
          } catch (e) {
            messages.push({
              role: 'tool',
              tool_call_id: call.id,
              name: call.function.name,
              content: JSON.stringify({ error: String(e) })
            });
          }
        }
      } else if (message.content) {
        finalContent = message.content;
        break;
      }
    }

    if (!finalContent) throw new Error('Agent loop exhausted without emitting final JSON');

    try {
      const parsed = JSON.parse(finalContent);
      if (!Array.isArray(parsed.selections) || !Array.isArray(parsed.unmatchedNeedIds)) {
        throw new Error('Parsed JSON does not match StackProposal interface');
      }
      
      // Enforce the constraint for this participant
      for (const sel of parsed.selections) {
        sel.source = 'model-with-lurq';
      }
      return parsed as StackProposal;
    } catch (err) {
      throw new Error(`Failed to parse final JSON: ${err instanceof Error ? err.message : String(err)}\nRaw response: ${finalContent}`);
    }
  }
}
