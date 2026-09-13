/**
 * The words in lurq's email, shared by the HTML templates and the plain-text
 * part so the two can never say different things.
 */
import type { DigestSummary, UrgentItem, UrgentKind } from './types';

export const KIND_LABEL: Record<UrgentKind, string> = {
  mcp_rug_pull: 'Tool rewritten to instruct your agent',
  mcp_privilege: 'Tool can now do more than you approved',
  breaking_release: 'Breaking release will install on its own',
};

/** Subject lines are plain text and must not carry newlines (header injection). */
export const oneLine = (s: string, max = 120) => s.replace(/[\r\n]+/g, ' ').slice(0, max);

export const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

export function urgentCopy(items: UrgentItem[]) {
  return {
    subject:
      items.length === 1 ? `lurq: ${oneLine(items[0]!.title)}` : `lurq: ${items.length} urgent changes to what your agents depend on`,
    intro: items.length === 1 ? 'One change needs a look today.' : `${items.length} changes need a look today.`,
    why: 'You get this because urgent alerts are on for your lurq account. They only fire for changes like these.',
  };
}

export function digestCopy(s: DigestSummary) {
  const quiet = s.mcpChangeTotal === 0 && s.alertTotal === 0 && s.unreadable.length === 0 && s.stale.length === 0;
  return {
    quiet,
    headline: quiet
      ? `A quiet week: nothing changed across ${plural(s.watched.servers, 'MCP server')} and ${plural(s.watched.repos, 'repo')}.`
      : `This week: ${plural(s.mcpChangeTotal, 'MCP change')}, ${plural(s.alertTotal, 'breaking release')}.`,
    subject: oneLine(
      `lurq weekly: ${quiet ? 'nothing changed' : `${plural(s.mcpChangeTotal, 'MCP change')}, ${plural(s.alertTotal, 'breaking release')}`}`,
    ),
    why: 'You get this because you turned on the weekly summary.',
  };
}
