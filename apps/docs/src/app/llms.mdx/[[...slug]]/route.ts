import { notFound } from 'next/navigation';
import { getLLMText } from '@/lib/get-llm-text';
import { source } from '@/lib/source';

// One docs page as markdown. Reached as /docs/<page>.md through the rewrite in
// next.config.mjs, and advertised from each page as its text/markdown alternate,
// so an agent that fetches a docs page can read it without the layout.
export const revalidate = false;

export async function GET(_req: Request, { params }: { params: Promise<{ slug?: string[] }> }): Promise<Response> {
  const { slug } = await params;
  const page = source.getPage(slug);
  if (!page) notFound();
  return new Response(await getLLMText(page), {
    headers: { 'Content-Type': 'text/markdown; charset=utf-8' },
  });
}

export function generateStaticParams() {
  return source.generateParams();
}
