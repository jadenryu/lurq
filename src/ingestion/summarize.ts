/**
 * Summary + usage-guide generation (§9.6 + R1 explainer refinement).
 *
 * lurq generates its OWN guide grounded in the package's README/description —
 * it never depends on Context7. When a summary LLM key is configured we use it;
 * otherwise we fall back to the npm description + a category-derived guide,
 * fabricating nothing. The exact current API is deferred to Context7 via a hint.
 */
import type { Category, UsageGuide } from '../core/types';
import { getConfig } from '../core/config';
import { httpRequest } from '../core/http';
import { logger } from '../core/logger';
import { fetchGithubReadme } from './sources/githubReadme';
import type { RawPackageSignals } from './types';

export interface SummaryInput {
  name: string;
  description: string | null;
  category: Category | null;
  readme: string | null;
  repoUrl: string | null;
}

export interface SummaryResult {
  summary: string | null;
  usageGuide: UsageGuide;
}

export interface SummaryProvider {
  readonly kind: 'openai' | 'fallback';
  generate(input: SummaryInput): Promise<SummaryResult>;
}

/** Human-readable architectural role per category (generic — lurq has no code context). */
const CATEGORY_ROLE: Record<string, string> = {
  framework: 'the core application framework your app is built on',
  'meta-framework': 'the full-stack framework wrapping routing, rendering, and build',
  'state-management': 'the client state layer shared across components',
  routing: 'the routing layer mapping URLs to views',
  orm: 'the data-access layer between your code and the database',
  'database-client': 'the low-level driver that talks to your database',
  'ui-component-library': 'the prebuilt UI component layer',
  styling: 'the styling layer for your components',
  forms: 'form state and submission handling',
  validation: 'input/schema validation at your boundaries',
  'data-fetching': 'the server-state/data-fetching layer',
  'http-client': 'the HTTP request layer for calling APIs',
  auth: 'authentication and session handling',
  testing: 'the test tooling layer',
  'build-tool': 'the build/dev pipeline',
  bundler: 'the module bundling step',
  linting: 'code-quality and formatting checks',
  'date-time': 'date and time handling',
  animation: 'UI animation and motion',
  charts: 'data visualization and charts',
  i18n: 'internationalization and localization',
  utility: 'a focused helper you compose into your app',
  other: 'a supporting library in your app',
};

function context7Hint(name: string): string {
  return `For the exact current API of "${name}", resolve it via Context7 (resolve-library-id → query-docs).`;
}

/** Keep text to ~`max` sentences. */
export function truncateSentences(text: string, max = 3): string {
  const clean = text.replace(/\s+/g, ' ').trim();
  if (!clean) return '';
  // Match full sentences, plus a trailing fragment with no terminal punctuation
  // (so descriptions without a period return the whole text, not just the last word).
  const sentences = clean.match(/[^.!?]+[.!?]+|[^.!?]+$/g) ?? [clean];
  return sentences
    .slice(0, max)
    .map((s) => s.trim())
    .join(' ')
    .trim();
}

// ── Fallback provider (no LLM key) ──────────────────────────────────────────

export class FallbackSummaryProvider implements SummaryProvider {
  readonly kind = 'fallback' as const;

  async generate(input: SummaryInput): Promise<SummaryResult> {
    const description = input.description?.trim() || null;
    const role = CATEGORY_ROLE[input.category ?? 'other'] ?? CATEGORY_ROLE.other!;
    const summary = description ? truncateSentences(description, 3) : null;
    const guide: UsageGuide = {
      whatItIs: description ? truncateSentences(description, 2) : input.name,
      whenToUse: `Reach for ${input.name} when you need ${role}.`,
      whereItFits: `Sits at ${role}.`,
      context7Hint: context7Hint(input.name),
    };
    return { summary, usageGuide: guide };
  }
}

// ── OpenAI provider (raw fetch, no SDK dependency) ──────────────────────────

const SYSTEM_PROMPT =
  'You summarize npm packages factually for an AI coding agent choosing dependencies. ' +
  'Use ONLY the provided README/description. Never invent capabilities or APIs. ' +
  'Be concise and concrete. Respond with a JSON object.';

function buildUserPrompt(input: SummaryInput): string {
  const readme = (input.readme ?? '').slice(0, 4000);
  return [
    `Package: ${input.name}`,
    `Category: ${input.category ?? 'unknown'}`,
    `Description: ${input.description ?? '(none)'}`,
    `README (truncated):\n${readme || '(none)'}`,
    '',
    'Return JSON with keys:',
    '- "summary": 2-3 sentences: what it is, when to use it, how it fits an app.',
    '- "whatItIs": one sentence.',
    '- "whenToUse": one sentence on the ideal use case.',
    '- "whenNotToUse": one sentence on when to pick something else (or "").',
    '- "whereItFits": one sentence on its architectural role.',
    '- "howToWireIn": one short sentence on the minimal setup (install + entry point), or "".',
  ].join('\n');
}

export class OpenAISummaryProvider implements SummaryProvider {
  readonly kind = 'openai' as const;

  constructor(
    private readonly apiKey: string,
    private readonly model: string,
    private readonly fetchImpl?: typeof fetch,
  ) {}

  async generate(input: SummaryInput): Promise<SummaryResult> {
    try {
      const body = JSON.stringify({
        model: this.model,
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: buildUserPrompt(input) },
        ],
        response_format: { type: 'json_object' },
        temperature: 0.2,
      });
      const { data } = await httpRequest<any>('https://api.openai.com/v1/chat/completions', {
        host: 'api.openai.com',
        method: 'POST',
        ttlMs: 30 * 24 * 60 * 60 * 1000, // cache summaries 30d to control cost
        cacheKey: `openai-summary ${this.model} ${input.name} ${(input.readme ?? '').length}`,
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
        },
        body,
        fetchImpl: this.fetchImpl,
      });
      const content = data?.choices?.[0]?.message?.content;
      const parsed = content ? JSON.parse(content) : {};
      const guide: UsageGuide = {
        whatItIs: str(parsed.whatItIs) || input.name,
        whenToUse: str(parsed.whenToUse),
        whenNotToUse: str(parsed.whenNotToUse) || undefined,
        whereItFits: str(parsed.whereItFits),
        howToWireIn: str(parsed.howToWireIn) || undefined,
        context7Hint: context7Hint(input.name),
      };
      return { summary: str(parsed.summary) ? truncateSentences(parsed.summary, 3) : null, usageGuide: guide };
    } catch (err) {
      logger.warn(`summary LLM failed for ${input.name}, using fallback: ${(err as Error).message}`);
      return new FallbackSummaryProvider().generate(input);
    }
  }
}

function str(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

// ── Factory + input assembly ────────────────────────────────────────────────

export function createSummaryProvider(fetchImpl?: typeof fetch): SummaryProvider {
  const config = getConfig();
  if (config.SUMMARY_PROVIDER === 'openai' && config.SUMMARY_API_KEY) {
    return new OpenAISummaryProvider(config.SUMMARY_API_KEY, config.SUMMARY_MODEL, fetchImpl);
  }
  return new FallbackSummaryProvider();
}

/** Assemble the summary input, fetching the GitHub-raw README when npm's is empty. */
export async function buildSummaryInput(
  signals: RawPackageSignals,
  category: Category | null,
  fetchImpl?: typeof fetch,
): Promise<SummaryInput> {
  const registry = signals.registry;
  let readme = registry?.readme?.trim() || null;
  if (!readme && registry?.repo) {
    readme = await fetchGithubReadme(registry.repo.owner, registry.repo.repo, fetchImpl).catch(
      () => null,
    );
  }
  return {
    name: signals.name,
    description: registry?.description ?? null,
    category,
    readme,
    repoUrl: registry?.repoUrl ?? null,
  };
}
