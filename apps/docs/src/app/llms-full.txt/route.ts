import { getLLMText } from '@/lib/get-llm-text';
import { source } from '@/lib/source';

// Every docs page, concatenated as markdown, at /docs/llms-full.txt. The web
// app's /llms.txt points here for readers that want the whole manual in one read.
export const revalidate = false;

export async function GET(): Promise<Response> {
  const pages = await Promise.all(source.getPages().map(getLLMText));
  return new Response(pages.join('\n\n'), {
    headers: { 'Content-Type': 'text/markdown; charset=utf-8' },
  });
}
