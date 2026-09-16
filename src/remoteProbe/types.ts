/**
 * The vocabulary of a credential-free read of a remote MCP endpoint.
 *
 * A remote endpoint is probed the way a client first meets it: an
 * unauthenticated request, then — if it is refused — the OAuth discovery chain
 * the spec defines (2026-07-28 authorization, RFC 9728 / RFC 8414). Everything
 * here is what that first meeting can establish without anyone's credentials,
 * and nothing it cannot. A 401 is not a broken server; a server that answered
 * `tools/list` openly is not thereby safe. Statuses are chosen so neither claim
 * can be read into them.
 */
import type { Snapshot } from '../mcpScan/snapshot';

export type EndpointStatus =
  /** `tools/list` answered without credentials; the contract was read. */
  | 'open'
  /** Refused with 401/403. `auth` says whether a client can sign in, and how. */
  | 'auth_required'
  /** 404/410: the published URL does not serve MCP (dead or moved). */
  | 'not_found'
  /** 5xx. */
  | 'server_error'
  /** Connection refused, reset, TLS failure or no response. */
  | 'unreachable'
  /** The hostname does not resolve. */
  | 'dns_failed'
  /** Refused by lurq's own policy: non-https, private address, local hostname. */
  | 'blocked'
  /** Answered, but not as an MCP server (not JSON-RPC, unexpected status). */
  | 'protocol_error'
  | 'timeout'
  /** The URL contains `{placeholders}` the user must fill in; nothing to probe. */
  | 'templated';

/** Statuses that say the endpoint is not usable by anyone right now. */
export const DEAD_STATUSES: ReadonlySet<EndpointStatus> = new Set([
  'not_found',
  'server_error',
  'unreachable',
  'dns_failed',
]);

export type AuthMode =
  /** No challenge: works without credentials. */
  | 'none'
  /** Challenged, with OAuth discovery a client can follow. */
  | 'oauth'
  /** Challenged, no OAuth discovery: a key or token must be configured by hand. */
  | 'static'
  /** Not established (the endpoint never answered). */
  | 'unknown';

export interface OAuthProfile {
  /** Where the protected resource metadata was found, and how. */
  resourceMetadataUrl: string | null;
  resourceMetadataVia: 'www_authenticate' | 'well_known_path' | 'well_known_root' | null;
  resource: string | null;
  authorizationServers: string[];
  scopesSupported: string[] | null;
  /** `scope` from the WWW-Authenticate challenge, when given. */
  challengeScope: string | null;
  /** The authorization server actually used, and where its metadata lives. */
  issuer: string | null;
  asMetadataUrl: string | null;
  /** `client_id_metadata_document_supported: true` (the spec's preferred registration). */
  cimd: boolean;
  /** A `registration_endpoint` (RFC 7591; deprecated in MCP but near-universal). */
  dcr: boolean;
  /** `code_challenge_methods_supported` includes S256. */
  pkceS256: boolean;
  /** `authorization_response_iss_parameter_supported` (RFC 9207), null when not stated. */
  issParameter: boolean | null;
}

export interface DeclaredHeader {
  name: string;
  required: boolean;
  secret: boolean;
  description: string | null;
}

export interface AuthProfile {
  mode: AuthMode;
  /** The HTTP status of the challenge, when there was one. */
  challengeStatus: number | null;
  oauth: OAuthProfile | null;
  /** What the registry says to send, across every server entry naming this URL. */
  declaredHeaders: DeclaredHeader[];
}

/**
 * Deviations a strict client acts on. Each is something the spec says a client
 * MUST check, so a server carrying one works in lenient clients and fails in
 * compliant ones — the "works in ChatGPT, not in Claude" class of report.
 */
export type ViolationCode =
  | 'resource_metadata_not_absolute'
  | 'resource_metadata_unreachable'
  | 'resource_metadata_invalid'
  | 'resource_mismatch'
  | 'as_metadata_unreachable'
  | 'issuer_mismatch'
  | 'pkce_s256_not_advertised'
  | 'no_client_registration'
  | 'challenge_without_resource_metadata';

export interface Violation {
  code: ViolationCode;
  detail: string;
}

export type ProtocolMode = 'stateless' | 'initialize';

export interface ProbeResult {
  url: string;
  status: EndpointStatus;
  httpStatus: number | null;
  /** The transport that answered. */
  transport: 'streamable-http' | 'sse' | null;
  protocolMode: ProtocolMode | null;
  protocolVersion: string | null;
  serverName: string | null;
  serverVersion: string | null;
  auth: AuthProfile;
  violations: Violation[];
  /** The contract, when `status` is `open`. */
  snapshot: Snapshot | null;
  /** Our words for what went wrong; never a response body. */
  error: string | null;
  latencyMs: number | null;
  /** Set when the endpoint redirected before answering. */
  finalUrl: string | null;
}
