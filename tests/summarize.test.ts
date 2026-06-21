import { describe, it, expect } from 'vitest';
import { FallbackSummaryProvider, truncateSentences } from '../src/ingestion/summarize';

describe('truncateSentences', () => {
  it('keeps at most N sentences and collapses whitespace', () => {
    const text = 'One.  Two!  Three?  Four.';
    expect(truncateSentences(text, 3)).toBe('One. Two! Three?');
  });

  it('handles empty input', () => {
    expect(truncateSentences('')).toBe('');
  });

  it('returns the whole text when there is no terminal punctuation', () => {
    expect(truncateSentences('React Hooks for form state management')).toBe(
      'React Hooks for form state management',
    );
  });
});

describe('FallbackSummaryProvider', () => {
  const provider = new FallbackSummaryProvider();

  it('derives a summary from the description and a category-based guide', async () => {
    const { summary, usageGuide } = await provider.generate({
      name: 'zod',
      description: 'TypeScript-first schema validation. Parse, do not validate.',
      category: 'validation',
      readme: null,
      repoUrl: 'https://github.com/colinhacks/zod',
    });
    expect(summary).toContain('schema validation');
    expect(usageGuide.whatItIs).toBeTruthy();
    expect(usageGuide.whereItFits).toMatch(/validation/i);
    expect(usageGuide.context7Hint).toContain('Context7');
  });

  it('falls back to the package name when there is no description', async () => {
    const { summary, usageGuide } = await provider.generate({
      name: 'mystery-pkg',
      description: null,
      category: null,
      readme: null,
      repoUrl: null,
    });
    expect(summary).toBeNull();
    expect(usageGuide.whatItIs).toBe('mystery-pkg');
  });
});
