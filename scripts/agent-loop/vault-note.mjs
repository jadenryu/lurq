// Writes one Obsidian note per task. The markdown IS the audit trail: the
// frontmatter holds status/gates, and the wikilinks ([[...]]) to the PR and the
// backlog are what make Obsidian's graph view connect tasks -> PRs -> backlog.

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const yamlList = (a) => (a.length ? '\n' + a.map((x) => `  - ${x}`).join('\n') : ' []');

export function writeVaultNote(dir, r) {
  mkdirSync(dir, { recursive: true });
  const ts = new Date().toISOString();
  const prNumber = r.prUrl ? r.prUrl.split('/').pop() : null;
  const prWikilink = prNumber ? `[[PRs/PR-${prNumber}]]` : '';

  const frontmatter = [
    '---',
    `id: ${r.id}`,
    `title: ${JSON.stringify(r.title)}`,
    `status: ${r.status}`,
    `source: ${r.source}`,
    `branch: ${r.branch}`,
    `pr_url: ${r.prUrl ?? ''}`,
    `created: ${ts}`,
    'gates:',
    `  typecheck: ${r.gates.typecheck ?? 'n/a'}`,
    `  lint: ${r.gates.lint ?? 'n/a'}`,
    `  test: ${r.gates.test ?? 'n/a'}`,
    `files_touched:${yamlList(r.filesTouched)}`,
    '---',
  ].join('\n');

  const body = [
    `# ${r.title}`,
    '',
    `**Status:** ${r.status}  •  **Source:** ${r.source}  •  **Branch:** \`${r.branch}\``,
    '',
    '## Summary',
    r.summary || '_No summary produced._',
    '',
    '## Files touched',
    r.filesTouched.length ? r.filesTouched.map((f) => `- \`${f}\``).join('\n') : '_None._',
    '',
    '## Links',
    '- Parent: [[backlog]]',
    prWikilink ? `- Pull request: ${prWikilink}  (${r.prUrl})` : '- Pull request: _none_',
    '',
  ].join('\n');

  writeFileSync(join(dir, `${r.id}.md`), `${frontmatter}\n\n${body}\n`);
}
