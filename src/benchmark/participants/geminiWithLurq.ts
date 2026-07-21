import type { Database } from '../../db/client';
import type { BenchmarkCase, Participant, StackProposal } from '../types';
import { formatPrompt } from './prompt';
import { handlePlan } from '../../mcp/plan';
import { handleVerify, handleCompat } from '../../mcp/handlers';

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
                  category: { type: 'STRING' }
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
        parameters: {
          type: 'OBJECT',
          properties: {
            package: { type: 'STRING' }
          },
          required: ['package']
        }
      },
      {
        name: 'compat',
        description: 'Check if a list of packages are compatible with each other.',
        parameters: {
          type: 'OBJECT',
          properties: {
            packages: {
              type: 'ARRAY',
              items: { type: 'STRING' }
            }
          },
          required: ['packages']
        }
      }
    ]
  }
];

export class GeminiWithLurqParticipant implements Participant {
  readonly kind = 'gemini-with-lurq';

  constructor(
    public readonly id: string,
    public readonly model: string
  ) {}

  async run(db: Database, benchCase: BenchmarkCase): Promise<StackProposal> {
    const key = process.env.GEMINI_API_KEY;
    if (!key) throw new Error(`Participant ${this.id} requires GEMINI_API_KEY in .env`);

    const contents: any[] = [
      { 
        role: 'user', 
        parts: [{ text: formatPrompt(benchCase) + '\n\nYou have access to Lurq MCP tools. Use them to pick the best stack before emitting your final JSON.' }] 
      }
    ];

    let finalContent: string | null = null;
    let iterations = 0;
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${this.model}:generateContent?key=${key}`;

    while (iterations < 5) {
      iterations++;
      
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents,
          tools: TOOLS,
          // When tools are provided, Gemini sometimes ignores responseMimeType in older models, but we'll include it.
        }),
      });

      if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new Error(`Gemini API error ${res.status}: ${text}`);
      }

      const data = await res.json() as any;
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
      
      if (toolCalls.length > 0) {
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
              resultObj = await handleCompat(db, { packages: args.packages });
            } else {
              resultObj = { error: 'Unknown tool' };
            }

            functionResponses.push({
              functionResponse: {
                name: call.name,
                response: resultObj
              }
            });
          } catch (e) {
            functionResponses.push({
              functionResponse: {
                name: call.name,
                response: { error: String(e) }
              }
            });
          }
        }
        
        contents.push({
          role: 'user',
          parts: functionResponses
        });
      } else {
        const textContent = parts.find((p: any) => p.text)?.text;
        if (textContent) {
          finalContent = textContent;
          break;
        } else {
           throw new Error('Gemini returned no text content and no tool calls');
        }
      }
    }

    if (!finalContent) throw new Error('Agent loop exhausted without emitting final JSON');

    let jsonStr = finalContent.replace(/^[\s\S]*```(?:json)?\s*/i, '').replace(/```\s*[\s\S]*$/, '').trim();

    // Extract balanced JSON object to handle Gemini emitting extra or missing trailing braces
    const start = jsonStr.indexOf('{');
    if (start !== -1) {
      let balance = 0;
      let endIndex = -1;
      for (let i = start; i < jsonStr.length; i++) {
        if (jsonStr[i] === '{') balance++;
        else if (jsonStr[i] === '}') {
          balance--;
          if (balance === 0) {
            endIndex = i;
            break;
          }
        }
      }
      if (endIndex !== -1) {
        jsonStr = jsonStr.substring(start, endIndex + 1);
      } else if (balance > 0) {
        jsonStr = jsonStr.substring(start) + '}'.repeat(balance);
      }
    }

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
      throw new Error(`Failed to parse Gemini JSON response: ${err instanceof Error ? err.message : String(err)}\nRaw response: ${finalContent}`);
    }
  }
}
