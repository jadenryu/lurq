/**
 * Pinned: the one-click links decode to the entries setup would write, the docs
 * carry exactly these links, and the Claude Code plugin ships the same skill and
 * endpoint as `lurq setup`.
 */
import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { DEFAULT_ENDPOINT } from '../src/core/constants';
import { KEY_PLACEHOLDER, cursorInstallLink, vscodeInstallLink } from '../src/cli/installLinks';
import { buildSkillFile } from '../src/cli/installSkill';

const bearer = `Bearer ${KEY_PLACEHOLDER}`;

describe('install links', () => {
  it('Cursor gets base64 of the bare entry, with no key in it', () => {
    const url = new URL(cursorInstallLink());
    expect(url.protocol).toBe('cursor:');
    expect(url.searchParams.get('name')).toBe('lurq');
    const config = JSON.parse(Buffer.from(url.searchParams.get('config')!, 'base64').toString('utf8'));
    expect(config).toEqual({ url: DEFAULT_ENDPOINT, headers: { Authorization: bearer, 'X-Lurq-Client': 'cursor' } });
  });

  it('VS Code gets the named http entry, URL-encoded', () => {
    const link = vscodeInstallLink();
    expect(link.startsWith('vscode:mcp/install?')).toBe(true);
    const entry = JSON.parse(decodeURIComponent(link.slice('vscode:mcp/install?'.length)));
    expect(entry).toEqual({
      name: 'lurq',
      type: 'http',
      url: DEFAULT_ENDPOINT,
      headers: { Authorization: bearer, 'X-Lurq-Client': 'copilot' },
    });
  });

  it('the docs carry exactly these links', () => {
    const docs = readFileSync('apps/docs/content/docs/quickstart.mdx', 'utf8');
    expect(docs).toContain(`href="${cursorInstallLink()}"`);
    expect(docs).toContain(`href="${vscodeInstallLink()}"`);
  });
});

describe('Claude Code plugin', () => {
  const plugin = JSON.parse(readFileSync('plugins/lurq/.claude-plugin/plugin.json', 'utf8'));
  const marketplace = JSON.parse(readFileSync('.claude-plugin/marketplace.json', 'utf8'));

  it('ships the same skill setup installs', () => {
    const template = readFileSync('templates/skill-instructions.md', 'utf8');
    // Regenerate after editing the template:
    // npx tsx -e "import {readFileSync,writeFileSync} from 'node:fs'; import {buildSkillFile} from './src/cli/installSkill'; writeFileSync('plugins/lurq/skills/lurq/SKILL.md', buildSkillFile(readFileSync('templates/skill-instructions.md','utf8')))"
    expect(readFileSync('plugins/lurq/skills/lurq/SKILL.md', 'utf8')).toBe(buildSkillFile(template));
  });

  it('connects the hosted endpoint with the key the user gave at install', () => {
    expect(plugin.mcpServers.lurq).toMatchObject({
      type: 'http',
      url: DEFAULT_ENDPOINT,
      headers: { Authorization: 'Bearer ${user_config.api_key}' },
    });
    expect(plugin.userConfig.api_key).toMatchObject({ sensitive: true, required: true });
  });

  it('carries the npm package version, so a release bump reaches plugin users', () => {
    // Claude Code only updates an installed plugin when this string changes.
    expect(plugin.version).toBe(JSON.parse(readFileSync('package.json', 'utf8')).version);
  });

  it('is listed by the marketplace at a path that exists', () => {
    const entry = marketplace.plugins.find((p: { name: string }) => p.name === plugin.name);
    expect(entry).toBeDefined();
    expect(existsSync(`${entry.source}/.claude-plugin/plugin.json`)).toBe(true);
  });
});
