import type { Database } from '../../db/client';
import type { BenchmarkCase, Participant, StackProposal } from '../types';
import { formatPrompt } from './prompt';
import { handlePlan } from '../../mcp/plan';
import { handleVerify, handleCompat } from '../../mcp/handlers';

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
              category: { type: 'string' }
            },
            required: ['need']
          }
        }
      }
    }
  },
  {
    name: 'verify',
    description: 'Check if an npm package exists and gets its health score before selecting it.',
    input_schema: {
      type: 'object',
      properties: {
        package: { type: 'string' }
      },
      required: ['package']
    }
  },
  {
    name: 'compat',
    description: 'Check if a list of packages are compatible with each other.',
    input_schema: {
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
];

export class AnthropicWithLurqParticipant implements Participant {
  readonly kind = 'anthropic-with-lurq';

  constructor(
    public readonly id: string,
    public readonly model: string
  ) {}

  async run(db: Database, benchCase: BenchmarkCase): Promise<StackProposal> {
    const key = process.env.CLAUDE_API_KEY;
    if (!key) throw new Error(`Participant ${this.id} requires CLAUDE_API_KEY in .env`);

    const messages: any[] = [
      { role: 'user', content: formatPrompt(benchCase) + '\n\nYou have access to Lurq MCP tools. Use them to pick the best stack before emitting your final JSON wrapped in a ```json markdown block.' }
    ];

    let finalContent: string | null = null;
    let iterations = 0;

    while (iterations < 5) {
      iterations++;
      
      const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': key,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model: this.model,
          messages,
          tools: TOOLS,
          max_tokens: 4096,
        }),
      });

      if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new Error(`Anthropic API error ${res.status}: ${text}`);
      }

      const data = await res.json() as any;
      messages.push({ role: 'assistant', content: data.content });

      const toolCalls = data.content.filter((c: any) => c.type === 'tool_use');
      
      if (toolCalls.length > 0) {
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
              resultObj = await handleCompat(db, { packages: args.packages });
            } else {
              resultObj = { error: 'Unknown tool' };
            }

            toolResults.push({
              type: 'tool_result',
              tool_use_id: call.id,
              content: JSON.stringify(resultObj)
            });
          } catch (e) {
            toolResults.push({
              type: 'tool_result',
              tool_use_id: call.id,
              content: JSON.stringify({ error: String(e) }),
              is_error: true
            });
          }
        }
        
        messages.push({
          role: 'user',
          content: toolResults
        });
      } else {
        const textContent = data.content.find((c: any) => c.type === 'text')?.text;
        if (textContent) {
          finalContent = textContent;
          break;
        } else {
           throw new Error('Anthropic returned no text content and no tool calls');
        }
      }
    }

    if (!finalContent) throw new Error('Agent loop exhausted without emitting final JSON');

    const jsonStr = finalContent.replace(/^[\s\S]*```json\s*/, '').replace(/```\s*[\s\S]*$/, '').trim();

    try {
      const parsed = JSON.parse(jsonStr);
      if (!Array.isArray(parsed.selections) || !Array.isArray(parsed.unmatchedNeedIds)) {
        throw new Error('Parsed JSON does not match StackProposal interface');
      }
      for (const sel of parsed.selections) {
        sel.source = 'model-with-lurq';
      }
      return parsed as StackProposal;
    } catch (err) {
      throw new Error(`Failed to parse Anthropic JSON response: ${err instanceof Error ? err.message : String(err)}\nRaw response: ${finalContent}`);
    }
  }
}
