import type { Database } from '../../db/client';
import type { BenchmarkCase, Participant, StackProposal } from '../types';
import { formatPrompt } from './prompt';
import { getConfig } from '../../core/config';

export class GeminiParticipant implements Participant {
  readonly kind = 'gemini';

  constructor(
    public readonly id: string,
    public readonly model: string
  ) {}

  async run(_db: Database, benchCase: BenchmarkCase): Promise<StackProposal> {
    const config = getConfig();
    const key = process.env.GEMINI_API_KEY; // Using process.env as getConfig might not have GEMINI_API_KEY
    if (!key) {
      throw new Error(`Participant ${this.id} requires GEMINI_API_KEY in .env`);
    }

    const prompt = formatPrompt(benchCase);
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${this.model}:generateContent?key=${key}`;

    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { 
          temperature: 0,
          responseMimeType: "application/json"
        },
      }),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`Gemini API error ${res.status}: ${text}`);
    }

    const data = await res.json() as any;
    const content = data.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!content) {
      throw new Error('Gemini returned no content');
    }

    let jsonStr = content.replace(/^[\s\S]*```(?:json)?\s*/i, '').replace(/```\s*[\s\S]*$/, '').trim();

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
      return parsed as StackProposal;
    } catch (err) {
      throw new Error(`Failed to parse Gemini JSON response: ${err instanceof Error ? err.message : String(err)}\nRaw response: ${content}`);
    }
  }
}
