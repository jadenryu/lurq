import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * The dashboard guide claims to be transcribed from the server rather than
 * written from memory, and its header asks whoever changes a tool to update it
 * "in the same commit". That is an honour system, and it had already failed:
 * `resolve_surface` and `diff_surface` shipped as the two tools the runtime-
 * surface thesis rests on, and the page a signed-in user reads to learn what
 * lurq does never mentioned either.
 *
 * Read as text rather than imported: the web app is outside this project's
 * tsconfig, and the coupling worth enforcing is "these two lists agree", which
 * does not need either module to load.
 */
const ROOT = join(__dirname, '..');

function registeredTools(): string[] {
  const src = readFileSync(join(ROOT, 'src/mcp/server.ts'), 'utf8');
  return [...src.matchAll(/server\.registerTool\(\s*'([a-z_]+)'/g)].map((m) => m[1]!).sort();
}

function documentedTools(): string[] {
  const src = readFileSync(join(ROOT, 'apps/web/src/content/guide.ts'), 'utf8');
  const block = src.slice(src.indexOf('export const TOOLS'), src.indexOf('export const TRIGGERS'));
  return [...block.matchAll(/name:\s*"([a-z_]+)"/g)].map((m) => m[1]!).sort();
}

describe('dashboard guide covers what the server ships', () => {
  it('finds tools on both sides', () => {
    // A regex that silently matches nothing would make every assertion below
    // vacuously true, which is the failure mode this whole file exists to catch.
    expect(registeredTools().length).toBeGreaterThan(5);
    expect(documentedTools().length).toBeGreaterThan(5);
  });

  it('documents every registered tool, and invents none', () => {
    expect(documentedTools()).toEqual(registeredTools());
  });
});

/**
 * The same honour system, one file over — and it had failed the same way.
 *
 * `templates/skill-instructions.md` is what `lurq setup` installs into an
 * agent, and it is the difference between a tool existing and a tool being
 * reached for. resolve_surface and diff_surface were registered, described, and
 * absent from the guide, so the agent that could have used them never learned
 * they were there. Enforcing it here means the next tool cannot ship invisible.
 *
 * agent-rules.md is deliberately NOT held to this: it is the always-loaded
 * block inside a file the user also writes in, so it stays a short brief rather
 * than a full index (see installSkill's InstructionKind).
 */
describe('the installed agent skill covers what the server ships', () => {
  it('mentions every registered tool', () => {
    const guide = readFileSync(join(ROOT, 'templates/skill-instructions.md'), 'utf8');
    const missing = registeredTools().filter((tool) => !guide.includes(tool));
    expect(missing).toEqual([]);
  });
});
