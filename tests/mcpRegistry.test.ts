/**
 * Declared server configuration, and the two negatives it keeps apart.
 *
 * A server that wants a GITHUB_TOKEN is not a server that is broken. Collapsing
 * the two is the §4.1 mistake — "we could not check" reported as "we checked
 * and it does not work" — and it is the one that costs the most trust, because
 * the user can see with their own eyes that the server works fine.
 */
import { describe, it, expect } from 'vitest';
import {
  configRequestLine,
  missingConfig,
  toManifest,
  type RegistryServer,
} from '../src/surface/mcpRegistry';
import { sniffMissingEnv } from '../src/pipeline/mcp';

const withEnv: RegistryServer = {
  name: 'ai.example/weather',
  version: '1.1.0',
  packages: [
    {
      registryType: 'npm',
      identifier: 'weather-mcp',
      version: '1.1.0',
      transport: { type: 'stdio' },
      environmentVariables: [
        { name: 'WEATHER_KEY', description: 'Your API key', isRequired: true, isSecret: true },
        { name: 'WEATHER_BASE', description: 'Override the base URL', format: 'string' },
      ],
    },
  ],
};

describe('toManifest', () => {
  it('reads declared settings off the matching npm package', () => {
    const m = toManifest(withEnv, 'weather-mcp')!;
    expect(m.transport).toBe('stdio');
    expect(m.env).toHaveLength(2);
    expect(m.env[0]).toMatchObject({ name: 'WEATHER_KEY', required: true, secret: true });
    // Absent isRequired/isSecret mean false, never "unknown-so-assume-required".
    expect(m.env[1]).toMatchObject({ required: false, secret: false });
  });

  /**
   * Registry search is fuzzy. Matching loosely would attribute one project's
   * credential requirements to another — telling a user to go get an API key
   * for software they are not installing.
   */
  it('refuses a server whose package identifier does not match exactly', () => {
    expect(toManifest(withEnv, 'weather-mcp-fork')).toBeNull();
  });

  it('flags a remote-only server rather than pretending it is installable', () => {
    const remote: RegistryServer = {
      name: 'ai.example/hosted',
      remotes: [{ type: 'streamable-http', url: 'https://example.com/mcp' }],
    };
    const m = toManifest(remote, 'anything')!;
    expect(m.remoteOnly).toBe(true);
    expect(m.transport).toBe('streamable-http');
  });

  it('returns null when there is neither a package nor a remote', () => {
    expect(toManifest({ name: 'ai.example/empty' }, 'nope')).toBeNull();
  });
});

describe('missingConfig', () => {
  const m = toManifest(withEnv, 'weather-mcp');

  it('reports only required settings the environment lacks', () => {
    expect(missingConfig(m, {}).map((e) => e.name)).toEqual(['WEATHER_KEY']);
    expect(missingConfig(m, { WEATHER_KEY: 'k' })).toEqual([]);
  });

  it('is empty for a server with no manifest, so an unknown server still probes', () => {
    expect(missingConfig(null, {})).toEqual([]);
  });
});

describe('configRequestLine', () => {
  const m = toManifest(withEnv, 'weather-mcp');

  it('names the setting and why, and never carries a value', () => {
    const line = configRequestLine('weather-mcp', missingConfig(m, {}));
    expect(line).toContain('WEATHER_KEY');
    expect(line).toContain('Your API key');
    expect(line).toMatch(/credential/);
  });

  it('says nothing when nothing is missing', () => {
    expect(configRequestLine('weather-mcp', [])).toBe('');
  });
});

describe('sniffMissingEnv', () => {
  // The fallback for servers with no published manifest, which is most of them.
  it('reads a server complaining about its own configuration', () => {
    expect(sniffMissingEnv('Error: GITHUB_TOKEN environment variable is required')).toBe(
      'GITHUB_TOKEN',
    );
    expect(sniffMissingEnv('missing required env BRAVE_API_KEY')).toBe('BRAVE_API_KEY');
    expect(sniffMissingEnv('SLACK_BOT_TOKEN is not defined')).toBe('SLACK_BOT_TOKEN');
  });

  /**
   * Excusing a genuine crash as "unconfigured" hides a real defect, so the
   * heuristic has to stay narrow: an env-shaped name is not enough on its own.
   */
  it('does not excuse a crash that merely mentions a variable', () => {
    expect(sniffMissingEnv('TypeError: cannot read property x of undefined')).toBeNull();
    expect(sniffMissingEnv('reading NODE_ENV to pick a log level')).toBeNull();
    expect(sniffMissingEnv('exited 1')).toBeNull();
    expect(sniffMissingEnv('')).toBeNull();
  });
});
