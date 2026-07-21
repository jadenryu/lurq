import type { Database } from '../../db/client';
import type { BenchmarkCase, Participant, StackProposal } from '../types';
import { formatPrompt } from './prompt';
import { parseStackProposalJson } from './agentLoop';

export class AnthropicParticipant implements Participant {
  readonly kind = 'anthropic';

  constructor(
    public readonly id: string,
    public readonly model: string
  ) {}

  async run(_db: Database, benchCase: BenchmarkCase): Promise<StackProposal> {
    const key = process.env.CLAUDE_API_KEY;
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
        max_tokens: 8192,
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

    try {
      return parseStackProposalJson(content, 'unaided-model');
    } catch (err) {
      throw new Error(`Failed to parse Anthropic JSON response: ${err instanceof Error ? err.message : String(err)}\nRaw response: ${content}`);
    }
  }
}
