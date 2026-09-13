import type { source } from '@/lib/source';

/** Public origin the docs are served under (the web app proxies /docs here). */
const DOCS_ORIGIN = 'https://www.lurq.run/docs';

/** One docs page as markdown, headed by its canonical URL, for llms-full.txt. */
export async function getLLMText(page: (typeof source)['$inferPage']): Promise<string> {
  const processed = await page.data.getText('processed');
  return `# ${page.data.title} (${DOCS_ORIGIN}${page.url === '/' ? '' : page.url})

${processed}`;
}
