/**
 * OAuth discovery for a remote MCP endpoint, exactly as the 2026-07-28 spec
 * orders it, recording every place a server departs from it.
 *
 * The SDK has discovery helpers, but they answer "can I sign in?" and hide the
 * path they took. lurq needs the path: which document was found where, and each
 * deviation a strict client would refuse. Those deviations are the difference
 * between "works in ChatGPT" and "fails in Claude", so they are the product.
 *
 * Nothing here holds or sends a credential. It reads public metadata documents
 * a client reads before its user has signed in.
 */
import type { SafeFetch } from '../core/safeFetch';
import type { OAuthProfile, Violation } from './types';

const MAX_DOC_BYTES = 256_000;

export interface Challenge {
  scheme: string;
  params: Record<string, string>;
}

/**
 * Parse `WWW-Authenticate` (RFC 9110 §11.6.1): auth-scheme then comma-separated
 * auth-params, values quoted or bare. Tolerant of the spacing variations servers
 * send; the first challenge wins when several are present.
 */
export function parseWwwAuthenticate(header: string | null): Challenge | null {
  if (!header) return null;
  const m = /^\s*([A-Za-z0-9!#$%&'*+.^_`|~-]+)\s*(.*)$/s.exec(header);
  if (!m) return null;
  const params: Record<string, string> = {};
  const re = /([A-Za-z0-9!#$%&'*+.^_`|~-]+)\s*=\s*(?:"((?:[^"\\]|\\.)*)"|([^\s,]+))\s*,?/g;
  let p: RegExpExecArray | null;
  while ((p = re.exec(m[2] ?? '')) !== null) {
    const key = p[1]!.toLowerCase();
    if (!(key in params)) params[key] = p[2] !== undefined ? p[2].replace(/\\(.)/g, '$1') : p[3]!;
  }
  return { scheme: m[1]!.toLowerCase(), params };
}

async function readJson(
  fetch: SafeFetch,
  url: string,
  signal?: AbortSignal,
): Promise<Record<string, unknown> | null> {
  try {
    const res = await fetch(url, { headers: { accept: 'application/json' }, signal });
    if (res.status !== 200) {
      await res.body?.cancel().catch(() => {});
      return null;
    }
    const text = await res.text();
    if (text.length > MAX_DOC_BYTES) return null;
    const body = JSON.parse(text) as unknown;
    return body && typeof body === 'object' && !Array.isArray(body)
      ? (body as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

const strings = (v: unknown): string[] | null =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && x.length > 0) : null;

/** Protected resource metadata candidates, in the order the spec requires clients to try. */
export function resourceMetadataCandidates(
  endpoint: URL,
  headerValue: string | null,
): { url: string; via: OAuthProfile['resourceMetadataVia'] }[] {
  const out: { url: string; via: OAuthProfile['resourceMetadataVia'] }[] = [];
  if (headerValue) {
    try {
      out.push({ url: new URL(headerValue, endpoint).toString(), via: 'www_authenticate' });
    } catch {
      /* unparseable: fall through to well-known */
    }
  }
  const path = endpoint.pathname.replace(/\/+$/, '');
  if (path)
    out.push({
      url: `${endpoint.origin}/.well-known/oauth-protected-resource${path}`,
      via: 'well_known_path',
    });
  out.push({
    url: `${endpoint.origin}/.well-known/oauth-protected-resource`,
    via: 'well_known_root',
  });
  return out;
}

/** Authorization server metadata candidates for an issuer, in spec priority order. */
export function authServerMetadataCandidates(issuer: string): string[] {
  let u: URL;
  try {
    u = new URL(issuer);
  } catch {
    return [];
  }
  const path = u.pathname.replace(/\/+$/, '');
  if (!path) {
    return [
      `${u.origin}/.well-known/oauth-authorization-server`,
      `${u.origin}/.well-known/openid-configuration`,
    ];
  }
  return [
    `${u.origin}/.well-known/oauth-authorization-server${path}`,
    `${u.origin}/.well-known/openid-configuration${path}`,
    `${u.origin}${path}/.well-known/openid-configuration`,
  ];
}

/** Does a protected resource's declared `resource` cover the endpoint that was probed? */
export function resourceCovers(resource: string, endpoint: URL): boolean {
  try {
    const r = new URL(resource);
    if (r.origin.toLowerCase() !== endpoint.origin.toLowerCase()) return false;
    const rp = r.pathname.replace(/\/+$/, '');
    const ep = endpoint.pathname.replace(/\/+$/, '');
    return rp === '' || ep === rp || ep.startsWith(`${rp}/`);
  } catch {
    return false;
  }
}

export interface DiscoveryResult {
  /** Null when no protected resource metadata was found anywhere. */
  oauth: OAuthProfile | null;
  violations: Violation[];
}

/**
 * Follow the discovery chain for an endpoint that challenged a request.
 * Never throws: an unreachable document is a finding, not an error.
 */
export async function discoverOAuth(
  fetch: SafeFetch,
  endpoint: URL,
  challenge: Challenge | null,
  signal?: AbortSignal,
): Promise<DiscoveryResult> {
  const violations: Violation[] = [];
  const headerValue = challenge?.params.resource_metadata ?? null;
  if (headerValue && !/^https?:\/\//i.test(headerValue)) {
    violations.push({
      code: 'resource_metadata_not_absolute',
      detail: `WWW-Authenticate resource_metadata is "${headerValue.slice(0, 200)}", not an absolute URL; clients that do not resolve it cannot find the authorization server`,
    });
  }

  let prm: Record<string, unknown> | null = null;
  let found: { url: string; via: OAuthProfile['resourceMetadataVia'] } | null = null;
  let sawInvalid = false;
  for (const c of resourceMetadataCandidates(endpoint, headerValue)) {
    const doc = await readJson(fetch, c.url, signal);
    if (!doc) continue;
    if (!strings(doc.authorization_servers)?.length) {
      sawInvalid = true;
      continue;
    }
    prm = doc;
    found = c;
    break;
  }

  if (!prm || !found) {
    if (sawInvalid) {
      violations.push({
        code: 'resource_metadata_invalid',
        detail: 'protected resource metadata lists no authorization_servers',
      });
    } else if (headerValue) {
      violations.push({
        code: 'resource_metadata_unreachable',
        detail: 'the resource_metadata URL in WWW-Authenticate did not return a metadata document',
      });
    } else {
      violations.push({
        code: 'challenge_without_resource_metadata',
        detail:
          'refused without credentials but publishes no OAuth protected resource metadata; a key or token must be configured by hand',
      });
    }
    return { oauth: null, violations };
  }

  const authorizationServers = strings(prm.authorization_servers)!;
  const resource = typeof prm.resource === 'string' ? prm.resource : null;
  if (prm.resource !== undefined && resource === null) {
    violations.push({
      code: 'resource_metadata_invalid',
      detail: '`resource` in protected resource metadata is not a string',
    });
  } else if (resource && !resourceCovers(resource, endpoint)) {
    violations.push({
      code: 'resource_mismatch',
      detail: `protected resource metadata names resource ${resource.slice(0, 200)}, which does not cover ${endpoint.toString()}; clients that validate it refuse the token`,
    });
  }

  const profile: OAuthProfile = {
    resourceMetadataUrl: found.url,
    resourceMetadataVia: found.via,
    resource,
    authorizationServers,
    scopesSupported: strings(prm.scopes_supported),
    challengeScope: challenge?.params.scope ?? null,
    issuer: null,
    asMetadataUrl: null,
    cimd: false,
    dcr: false,
    pkceS256: false,
    issParameter: null,
  };

  const issuer = authorizationServers[0]!;
  for (const candidate of authServerMetadataCandidates(issuer)) {
    const asm = await readJson(fetch, candidate, signal);
    if (!asm || typeof asm.issuer !== 'string') continue;
    profile.issuer = asm.issuer;
    profile.asMetadataUrl = candidate;
    profile.cimd = asm.client_id_metadata_document_supported === true;
    profile.dcr =
      typeof asm.registration_endpoint === 'string' && asm.registration_endpoint.length > 0;
    profile.pkceS256 = strings(asm.code_challenge_methods_supported)?.includes('S256') ?? false;
    profile.issParameter =
      typeof asm.authorization_response_iss_parameter_supported === 'boolean'
        ? asm.authorization_response_iss_parameter_supported
        : null;

    if (asm.issuer !== issuer) {
      violations.push({
        code: 'issuer_mismatch',
        detail:
          asm.issuer.replace(/\/+$/, '') === issuer.replace(/\/+$/, '')
            ? `authorization server metadata issuer "${asm.issuer}" differs from "${issuer}" only by a trailing slash; the spec requires an identical string, so strict clients reject it`
            : `authorization server metadata issuer "${asm.issuer.slice(0, 200)}" does not match "${issuer.slice(0, 200)}"; clients must not use it`,
      });
    }
    if (!profile.pkceS256) {
      violations.push({
        code: 'pkce_s256_not_advertised',
        detail:
          'code_challenge_methods_supported does not include S256; compliant clients refuse to proceed',
      });
    }
    if (!profile.cimd && !profile.dcr) {
      violations.push({
        code: 'no_client_registration',
        detail:
          'neither Client ID Metadata Documents nor Dynamic Client Registration is offered; only clients where the user can enter a pre-registered client id can sign in',
      });
    }
    return { oauth: profile, violations };
  }

  violations.push({
    code: 'as_metadata_unreachable',
    detail: `no authorization server metadata found for ${issuer.slice(0, 200)}`,
  });
  return { oauth: profile, violations };
}
