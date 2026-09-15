import { describe, expect, it } from 'vitest';
import type { SafeFetch } from '../src/core/safeFetch';
import {
  authServerMetadataCandidates,
  discoverOAuth,
  parseWwwAuthenticate,
  resourceCovers,
  resourceMetadataCandidates,
} from '../src/remoteProbe/oauth';

describe('parseWwwAuthenticate', () => {
  it('reads quoted, bare and escaped params, case-insensitively', () => {
    expect(
      parseWwwAuthenticate('Bearer resource_metadata="https://mcp.x.dev/.well-known/oauth-protected-resource", scope="files:read files:write"'),
    ).toEqual({
      scheme: 'bearer',
      params: { resource_metadata: 'https://mcp.x.dev/.well-known/oauth-protected-resource', scope: 'files:read files:write' },
    });
    expect(parseWwwAuthenticate('Bearer Error=invalid_token,Realm="a \\"b\\""')).toEqual({
      scheme: 'bearer',
      params: { error: 'invalid_token', realm: 'a "b"' },
    });
  });

  it('returns null for nothing to parse', () => {
    expect(parseWwwAuthenticate(null)).toBeNull();
    expect(parseWwwAuthenticate('')).toBeNull();
  });
});

describe('discovery URL order', () => {
  it('tries the header, then the path-inserted well-known, then the root', () => {
    expect(resourceMetadataCandidates(new URL('https://x.dev/public/mcp'), '/prm')).toEqual([
      { url: 'https://x.dev/prm', via: 'www_authenticate' },
      { url: 'https://x.dev/.well-known/oauth-protected-resource/public/mcp', via: 'well_known_path' },
      { url: 'https://x.dev/.well-known/oauth-protected-resource', via: 'well_known_root' },
    ]);
    expect(resourceMetadataCandidates(new URL('https://x.dev'), null)).toEqual([
      { url: 'https://x.dev/.well-known/oauth-protected-resource', via: 'well_known_root' },
    ]);
  });

  it('orders authorization server metadata by issuer shape, per the spec', () => {
    expect(authServerMetadataCandidates('https://auth.x.dev')).toEqual([
      'https://auth.x.dev/.well-known/oauth-authorization-server',
      'https://auth.x.dev/.well-known/openid-configuration',
    ]);
    expect(authServerMetadataCandidates('https://auth.x.dev/tenant1/')).toEqual([
      'https://auth.x.dev/.well-known/oauth-authorization-server/tenant1',
      'https://auth.x.dev/.well-known/openid-configuration/tenant1',
      'https://auth.x.dev/tenant1/.well-known/openid-configuration',
    ]);
    expect(authServerMetadataCandidates('not a url')).toEqual([]);
  });

  it('checks resource coverage by origin and path prefix', () => {
    const ep = new URL('https://mcp.x.dev/v1/mcp');
    expect(resourceCovers('https://mcp.x.dev', ep)).toBe(true);
    expect(resourceCovers('https://mcp.x.dev/v1/mcp/', ep)).toBe(true);
    expect(resourceCovers('https://mcp.x.dev/v1', ep)).toBe(true);
    expect(resourceCovers('https://mcp.x.dev/v2', ep)).toBe(false);
    expect(resourceCovers('https://other.dev/v1/mcp', ep)).toBe(false);
  });
});

/** A fetch backed by a map of URL → JSON document. */
function docs(map: Record<string, unknown>): SafeFetch {
  return async (input) => {
    const doc = map[input.toString()];
    return doc === undefined ? new Response('not found', { status: 404 }) : new Response(JSON.stringify(doc), { status: 200 });
  };
}

const EP = new URL('https://mcp.x.dev/mcp');
const PRM = 'https://mcp.x.dev/.well-known/oauth-protected-resource/mcp';
const AS = 'https://auth.x.dev/.well-known/oauth-authorization-server';

describe('discoverOAuth', () => {
  it('reads a compliant server end to end, with no violations', async () => {
    const fetch = docs({
      [PRM]: { resource: 'https://mcp.x.dev/mcp', authorization_servers: ['https://auth.x.dev'], scopes_supported: ['read'] },
      [AS]: {
        issuer: 'https://auth.x.dev',
        registration_endpoint: 'https://auth.x.dev/register',
        client_id_metadata_document_supported: true,
        code_challenge_methods_supported: ['S256'],
        authorization_response_iss_parameter_supported: true,
      },
    });
    const r = await discoverOAuth(fetch, EP, parseWwwAuthenticate(`Bearer resource_metadata="${PRM}", scope="read"`));
    expect(r.violations).toEqual([]);
    expect(r.oauth).toMatchObject({
      resourceMetadataVia: 'www_authenticate',
      authorizationServers: ['https://auth.x.dev'],
      issuer: 'https://auth.x.dev',
      challengeScope: 'read',
      cimd: true,
      dcr: true,
      pkceS256: true,
      issParameter: true,
    });
  });

  it('finds metadata at the well-known path when the header omits it, and flags a strict-client failure set', async () => {
    const fetch = docs({
      [PRM]: { authorization_servers: ['https://auth.x.dev'] },
      [AS]: { issuer: 'https://auth.x.dev/' },
    });
    const r = await discoverOAuth(fetch, EP, parseWwwAuthenticate('Bearer realm="x"'));
    expect(r.oauth?.resourceMetadataVia).toBe('well_known_path');
    expect(r.violations.map((v) => v.code).sort()).toEqual(['issuer_mismatch', 'no_client_registration', 'pkce_s256_not_advertised']);
    expect(r.violations.find((v) => v.code === 'issuer_mismatch')!.detail).toMatch(/trailing slash/);
  });

  it('says a key must be configured by hand when there is no discovery at all', async () => {
    const r = await discoverOAuth(docs({}), EP, null);
    expect(r.oauth).toBeNull();
    expect(r.violations.map((v) => v.code)).toEqual(['challenge_without_resource_metadata']);
  });

  it('flags a relative resource_metadata URL but still follows it', async () => {
    const fetch = docs({
      'https://mcp.x.dev/prm.json': { authorization_servers: ['https://auth.x.dev'] },
      [AS]: { issuer: 'https://auth.x.dev', registration_endpoint: 'https://auth.x.dev/r', code_challenge_methods_supported: ['S256'] },
    });
    const r = await discoverOAuth(fetch, EP, parseWwwAuthenticate('Bearer resource_metadata="/prm.json"'));
    expect(r.oauth?.resourceMetadataUrl).toBe('https://mcp.x.dev/prm.json');
    expect(r.violations.map((v) => v.code)).toEqual(['resource_metadata_not_absolute']);
  });

  it('reports metadata that names a different resource, a non-string resource, and an unreachable AS', async () => {
    const mismatch = await discoverOAuth(docs({ [PRM]: { resource: 'https://other.dev', authorization_servers: ['https://auth.x.dev'] } }), EP, null);
    expect(mismatch.violations.map((v) => v.code)).toEqual(['resource_mismatch', 'as_metadata_unreachable']);
    const listResource = await discoverOAuth(docs({ [PRM]: { resource: ['https://mcp.x.dev'], authorization_servers: ['https://auth.x.dev'] } }), EP, null);
    expect(listResource.violations.map((v) => v.code)).toContain('resource_metadata_invalid');
  });

  it('separates an unreachable header URL from an invalid document', async () => {
    const unreachable = await discoverOAuth(docs({}), EP, parseWwwAuthenticate(`Bearer resource_metadata="${PRM}"`));
    expect(unreachable.violations.map((v) => v.code)).toEqual(['resource_metadata_unreachable']);
    const invalid = await discoverOAuth(docs({ [PRM]: { authorization_servers: [] } }), EP, null);
    expect(invalid.violations.map((v) => v.code)).toEqual(['resource_metadata_invalid']);
  });
});
