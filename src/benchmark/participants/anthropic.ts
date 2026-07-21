import type { Database } from '../../db/client';
import type { BenchmarkCase, Participant, StackProposal } from '../types';
import { formatPrompt } from './prompt';
import { getConfig } from '../../core/config';

export class AnthropicParticipant implements Participant {
  readonly kind = 'anthropic';

  constructor(
    public readonly id: string,
    public readonly model: string
  ) {}

  async run(_db: Database, benchCase: BenchmarkCase): Promise<StackProposal> {
    const config = getConfig();
    const key = process.env.CLAUDE_API_KEY; // Using process.env as getConfig might not have CLAUDE_API_KEY if we didn't add it to Zod yet.
    if (!key) {
      throw new Error(`Participant ${this.id} requires CLAUDE_API_KEY in .env`);
    }

    const prompt = formatPrompt(benchCase);

    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': key,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: this.model,
        messages: [{ role: 'user', content: prompt }],
        max_tokens: 4096, // required by Anthropic
        // temperature: 0 is deprecated for Sonnet 5
      }),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`Anthropic API error ${res.status}: ${text}`);
    }

    const data = await res.json() as any;
    const textBlock = data.content?.find((c: any) => c.type === 'text');
    const content = textBlock?.text;
    if (!content) {
      throw new Error(`Anthropic returned no text content. Raw data: ${JSON.stringify(data)}`);
    }

    // Anthropic often wraps JSON in markdown even if told not to
    const jsonStr = content.replace(/^```json\s*/, '').replace(/```\s*$/, '').trim();

    try {
      const parsed = JSON.parse(jsonStr);
      if (!Array.isArray(parsed.selections) || !Array.isArray(parsed.unmatchedNeedIds)) {
        throw new Error('Parsed JSON does not match StackProposal interface');
      }
      return parsed as StackProposal;
    } catch (err) {
      throw new Error(`Failed to parse Anthropic JSON response: ${err instanceof Error ? err.message : String(err)}\nRaw response: ${content}`);
    }
  }
}
