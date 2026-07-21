import type { Database } from '../../db/client';
import type { BenchmarkCase, Participant, StackProposal } from '../types';
import { formatPrompt } from './prompt';
import { getConfig } from '../../core/config';

export class OpenAIParticipant implements Participant {
  readonly kind = 'openai';

  constructor(
    public readonly id: string,
    public readonly model: string
  ) {}

  async run(_db: Database, benchCase: BenchmarkCase): Promise<StackProposal> {
    const config = getConfig();
    const key = config.SUMMARY_API_KEY || config.EMBEDDING_API_KEY;
    if (!key) {
      throw new Error(`Participant ${this.id} requires SUMMARY_API_KEY or EMBEDDING_API_KEY`);
    }

    const prompt = formatPrompt(benchCase);

    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${key}`,
      },
      body: JSON.stringify({
        model: this.model,
        messages: [{ role: 'user', content: prompt }],
        temperature: 1, // 0 is deprecated for new models like sol
        response_format: { type: 'json_object' }
      }),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`OpenAI API error ${res.status}: ${text}`);
    }

    const data = await res.json() as any;
    const content = data.choices?.[0]?.message?.content;
    if (!content) {
      throw new Error('OpenAI returned no content');
    }

    try {
      const parsed = JSON.parse(content);
      // Ensure the returned object has the required fields
      if (!Array.isArray(parsed.selections) || !Array.isArray(parsed.unmatchedNeedIds)) {
        throw new Error('Parsed JSON does not match StackProposal interface');
      }
      return parsed as StackProposal;
    } catch (err) {
      throw new Error(`Failed to parse OpenAI JSON response: ${err instanceof Error ? err.message : String(err)}\nRaw response: ${content}`);
    }
  }
}
