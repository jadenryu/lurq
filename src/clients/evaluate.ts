/**
 * Will this MCP server work in that client, and what does it take?
 *
 * The answer is assembled from two kinds of evidence and never from a guess:
 * what lurq observed about the server (a credential-free probe of its endpoint,
 * or its registry declaration) and what primary sources say about the client
 * (`./profiles`). Each rule below is a place those two meet.
 *
 * Four verdicts, chosen so none of them overclaims:
 *
 *   - works        — every decisive check passed
 *   - needs_setup  — it will work once the listed steps are done (a key, a
 *                    pre-registered OAuth client, a filled-in URL)
 *   - blocked      — something on one side rules it out, and the blocker says
 *                    which side and why
 *   - unknown      — a decisive fact is missing: the endpoint has not been
 *                    probed, or no source confirms the client capability
 *
 * Checks that could not run (tool names on a server whose list needs sign-in)
 * are reported, but only a DECISIVE unknown turns the verdict to unknown.
 */
import type { RequiredConfig } from '../surface/mcpRegistry';
import type { McpTool } from '../surface/mcp';
import {
  DEAD_STATUSES,
  type AuthProfile,
  type DeclaredHeader,
  type EndpointStatus,
  type Violation,
} from '../remoteProbe/types';
import type { ClientId, ClientProfile, Support } from './types';

export interface RemoteFacts {
  url: string;
  /** Observed transport when probed, otherwise the registry's declaration. */
  transport: string;
  templated: boolean;
  /** Null when never probed. */
  status: EndpointStatus | null;
  observedAt: Date | null;
  auth: AuthProfile | null;
  violations: Violation[];
  declaredHeaders: DeclaredHeader[];
}

export interface PackageFacts {
  registryType: string;
  identifier: string;
  env: RequiredConfig[];
}

export interface ServerFacts {
  /** Display name. */
  name: string;
  /** The key a user would give it in their config; tool-name prefixes are built from it. */
  alias: string;
  remote: RemoteFacts | null;
  package: PackageFacts | null;
  /** The tool list, when lurq has one. */
  tools: McpTool[] | null;
}

export type CompatVerdict = 'works' | 'needs_setup' | 'blocked' | 'unknown';

export interface CompatFinding {
  code: string;
  detail: string;
}

export interface ClientCompat {
  client: ClientId;
  clientName: string;
  verdict: CompatVerdict;
  /** How the client would connect. */
  via: 'remote' | 'package' | null;
  blockers: CompatFinding[];
  setup: CompatFinding[];
  warnings: CompatFinding[];
  /** Checks that could not be made; `decisive` ones are why a verdict is unknown. */
  unknowns: (CompatFinding & { decisive: boolean })[];
}

const usable = (s: Support) => s === 'yes' || s === 'partial';
const MAX_EXAMPLES = 3;

class Acc {
  blockers: CompatFinding[] = [];
  setup: CompatFinding[] = [];
  warnings: CompatFinding[] = [];
  unknowns: (CompatFinding & { decisive: boolean })[] = [];
  block(code: string, detail: string) {
    this.blockers.push({ code, detail });
  }
  step(code: string, detail: string) {
    this.setup.push({ code, detail });
  }
  warn(code: string, detail: string) {
    this.warnings.push({ code, detail });
  }
  unknown(code: string, detail: string, decisive: boolean) {
    this.unknowns.push({ code, detail, decisive });
  }
}

/** Which way can this client reach the server at all? */
function route(server: ServerFacts, client: ClientProfile): 'remote' | 'package' | null {
  const remoteSupport = server.remote
    ? client.transports[server.remote.transport === 'sse' ? 'sse' : 'streamableHttp']
    : 'no';
  if (server.remote && remoteSupport !== 'no') return 'remote';
  if (server.package && client.transports.stdio !== 'no') return 'package';
  return server.remote ? 'remote' : server.package ? 'package' : null;
}

function headerStep(headers: DeclaredHeader[]): string {
  const names = headers.filter((h) => h.required || h.secret).map((h) => h.name);
  const list = names.length ? names : headers.map((h) => h.name);
  return list.length
    ? `send ${list.join(', ')} with every request`
    : 'send the server’s API key, usually as `Authorization: Bearer <token>`';
}

function evaluateAuth(remote: RemoteFacts, client: ClientProfile, acc: Acc) {
  const auth = remote.auth;
  const mode = auth?.mode ?? (remote.status === 'open' ? 'none' : 'unknown');
  const c = client.auth;

  if (mode === 'none') {
    if (remote.declaredHeaders.some((h) => h.required)) {
      acc.warn(
        'declared_header_not_enforced',
        `the registry lists a required header (${headerStep(remote.declaredHeaders)}), but the endpoint answered without one`,
      );
    }
    return;
  }
  if (mode === 'unknown') {
    if (remote.status && !DEAD_STATUSES.has(remote.status))
      acc.unknown('auth_unknown', 'how this endpoint authenticates was not established', false);
    return;
  }
  // A note restating a rule already encoded in `strict` would read as a contradiction
  // of a verdict that has just checked that rule.
  if (c.note && !c.strict) acc.warn('client_auth_note', c.note);

  if (mode === 'static') {
    const step = headerStep(remote.declaredHeaders);
    if (c.staticHeaders === 'no')
      acc.block(
        'no_static_headers',
        `the server wants a key or token configured by hand (${step}), and ${client.name} cannot send custom headers to a remote server`,
      );
    else if (c.staticHeaders === 'unknown')
      acc.unknown(
        'static_headers_unknown',
        `the server wants a key configured by hand; no source confirms ${client.name} can send custom headers`,
        true,
      );
    else {
      acc.step('configure_key', step);
      if (c.staticHeaders === 'partial')
        acc.warn(
          'static_headers_partial',
          `${client.name} supports custom headers only with limitations`,
        );
    }
    return;
  }

  // OAuth.
  const o = auth!.oauth!;
  if (c.oauth === 'no') {
    if (usable(c.staticHeaders)) {
      acc.step(
        'token_instead_of_oauth',
        `${client.name} cannot run the OAuth sign-in; supply an access token as a header instead, if the server accepts one`,
      );
      acc.warn('oauth_unsupported', `${client.name} has no OAuth flow`);
    } else {
      acc.block(
        'oauth_unsupported',
        `the server requires OAuth sign-in and ${client.name} has no OAuth flow`,
      );
    }
    return;
  }
  if (c.oauth === 'unknown') {
    acc.unknown('oauth_unknown', `no source confirms ${client.name} runs the MCP OAuth flow`, true);
    return;
  }
  if (c.oauth === 'partial')
    acc.warn('oauth_partial', `${client.name}'s OAuth support has known limitations`);

  const viaCimd = o.cimd && usable(c.cimd);
  const viaDcr = o.dcr && usable(c.dcr);
  const offered =
    [o.cimd && 'Client ID Metadata Documents', o.dcr && 'Dynamic Client Registration']
      .filter(Boolean)
      .join(' and ') || 'no automatic registration';
  const redirects = c.redirectUris.length
    ? ` Allow redirect URI(s): ${c.redirectUris.join(', ')}.`
    : '';
  if (!viaCimd && !viaDcr) {
    const couldMatch = (o.cimd && c.cimd === 'unknown') || (o.dcr && c.dcr === 'unknown');
    if (couldMatch) {
      acc.unknown(
        'registration_unknown',
        `the server offers ${offered}; no source confirms whether ${client.name} supports it`,
        true,
      );
    } else if (usable(c.preRegistered)) {
      acc.step(
        'pre_register_client',
        `the server offers ${offered}, which ${client.name} cannot use: register an OAuth client with ${o.issuer ?? 'its authorization server'} and enter its client id in ${client.name}.${redirects}`,
      );
    } else if (c.preRegistered === 'unknown') {
      acc.unknown(
        'registration_unknown',
        `the server offers ${offered}, which ${client.name} cannot use, and no source confirms it accepts a pre-registered client`,
        true,
      );
    } else {
      acc.block(
        'no_shared_registration',
        `the server offers ${offered}; ${client.name} can use neither, and has no way to enter a pre-registered client`,
      );
    }
  } else if (
    (viaCimd && c.cimd === 'partial' && !viaDcr) ||
    (viaDcr && c.dcr === 'partial' && !viaCimd)
  ) {
    acc.warn(
      'registration_partial',
      `${client.name} supports the registration method this server offers only with limitations`,
    );
  }

  for (const v of remote.violations) {
    switch (v.code) {
      case 'pkce_s256_not_advertised':
        if (c.strict?.pkceS256Required)
          acc.block(
            'pkce_required',
            `${client.name} refuses authorization servers that do not advertise PKCE S256, and this one does not`,
          );
        else acc.warn('pkce_not_advertised', v.detail);
        break;
      case 'as_metadata_unreachable':
        acc.unknown('as_metadata_unreachable', v.detail, true);
        break;
      default:
        acc.warn(v.code, v.detail);
    }
  }
}

/** The name the model sees for one tool in this client. */
export function modelToolName(client: ClientProfile, alias: string, tool: string): string | null {
  if (!client.toolNaming.format) return null;
  let name = client.toolNaming.format.replace('{server}', alias).replace('{tool}', tool);
  if (client.toolNaming.replacedChars)
    name = name.replace(new RegExp(client.toolNaming.replacedChars, 'g'), '_');
  return name;
}

function evaluateTools(server: ServerFacts, client: ClientProfile, acc: Acc) {
  const tools = server.tools;
  if (!tools) {
    acc.unknown(
      'tools_unread',
      'the tool list was not readable without credentials, so name and schema limits were not checked',
      false,
    );
    return;
  }

  // Names.
  const max = client.toolNaming.maxLength;
  if (client.toolNaming.format && max) {
    const long = tools
      .map((t) => ({ tool: t.name, name: modelToolName(client, server.alias, t.name)! }))
      .filter((t) => t.name.length > max);
    if (long.length) {
      const ex = long
        .slice(0, MAX_EXAMPLES)
        .map((t) => `${t.name} (${t.name.length})`)
        .join(', ');
      const what = `${long.length} tool name(s) exceed ${client.name}'s ${max}-character limit once prefixed as "${client.toolNaming.format}", e.g. ${ex}`;
      switch (client.toolNaming.onOverflow) {
        case 'error':
          acc.block('tool_name_too_long', `${what}; requests fail`);
          break;
        case 'drop_tool':
          acc.warn('tool_name_dropped', `${what}; those tools are dropped`);
          break;
        case 'truncate': {
          const cut = new Map<string, string[]>();
          for (const t of tools) {
            const n = modelToolName(client, server.alias, t.name)!.slice(0, max);
            cut.set(n, [...(cut.get(n) ?? []), t.name]);
          }
          const clashes = [...cut.values()].filter((v) => v.length > 1);
          if (clashes.length)
            acc.block(
              'tool_name_collision',
              `${what}; truncation makes ${clashes
                .slice(0, MAX_EXAMPLES)
                .map((c) => c.join(' and '))
                .join('; ')} indistinguishable`,
            );
          else acc.warn('tool_name_truncated', `${what}; they are truncated`);
          break;
        }
        case 'truncate_hash':
          acc.warn('tool_name_truncated', `${what}; they are truncated with a hash suffix`);
          break;
        default:
          acc.warn(
            'tool_name_too_long',
            `${what}; what ${client.name} does with them is not documented`,
          );
      }
    }
  } else if (tools.length) {
    acc.unknown('tool_naming_unknown', `${client.name}'s tool-name limit is not documented`, false);
  }

  // Schemas.
  const schema = client.schema;
  const offending: { rule: string; tool: string }[] = [];
  for (const t of tools) {
    const s = t.inputSchema as Record<string, unknown> | undefined;
    if (!s || typeof s !== 'object') continue;
    const text = JSON.stringify(s);
    if (schema.rootCombinators === 'no' && ('anyOf' in s || 'oneOf' in s || 'allOf' in s))
      offending.push({ rule: 'a root-level anyOf/oneOf/allOf', tool: t.name });
    for (const kw of schema.rejectedKeywords)
      if (text.includes(`"${kw}"`)) offending.push({ rule: `\`${kw}\``, tool: t.name });
    if (
      (schema.typeArrays === 'no' || schema.typeArrays === 'partial') &&
      /"type"\s*:\s*\[/.test(text)
    )
      offending.push({ rule: 'type arrays', tool: t.name });
  }
  if (offending.length) {
    const rules = [...new Set(offending.map((o) => o.rule))].join(', ');
    const names = [...new Set(offending.map((o) => o.tool))];
    const what = `${names.length} tool(s) use ${rules}, which ${client.name} does not accept (e.g. ${names.slice(0, MAX_EXAMPLES).join(', ')})`;
    switch (schema.onInvalid) {
      case 'fail_request':
        acc.block('schema_rejected', `${what}; one such tool fails every request`);
        break;
      case 'drop_tool':
        acc.warn('schema_tool_dropped', `${what}; those tools are dropped`);
        break;
      case 'sanitize':
        break;
      default:
        acc.warn('schema_rejected', `${what}; how it handles them is not documented`);
    }
  }

  // Count.
  const cap = client.toolLimits.maxTools;
  if (cap && tools.length > cap && client.toolLimits.toolSearch !== 'yes') {
    acc.warn(
      'too_many_tools',
      `${tools.length} tools exceeds ${client.name}'s documented limit of ${cap}${client.toolLimits.scope ? ` (${client.toolLimits.scope.replace('_', ' ')})` : ''}`,
    );
  }
}

export function evaluateClient(server: ServerFacts, client: ClientProfile): ClientCompat {
  const acc = new Acc();
  const via = route(server, client);

  if (!via) {
    acc.unknown(
      'no_connection_info',
      'lurq has neither a remote endpoint nor a package for this server',
      true,
    );
  } else if (via === 'remote') {
    const r = server.remote!;
    const kind = r.transport === 'sse' ? 'sse' : 'streamableHttp';
    const support = client.transports[kind];
    const label = kind === 'sse' ? 'legacy HTTP+SSE' : 'Streamable HTTP';
    if (support === 'no') {
      acc.block(
        'transport_unsupported',
        `the server is reachable only over ${label}${server.package ? ' or as a local package' : ''}, and ${client.name} supports neither`,
      );
    } else if (support === 'unknown') {
      acc.unknown('transport_unknown', `no source confirms ${client.name} supports ${label}`, true);
    } else if (support === 'partial') {
      acc.warn(
        'transport_partial',
        `${client.name} supports ${label} only partially${kind === 'sse' ? ' (deprecated)' : ''}`,
      );
    }

    if (r.templated)
      acc.step('fill_url', `the URL has placeholders to fill in before connecting: ${r.url}`);
    if (r.status === null) {
      if (!r.templated) acc.unknown('not_probed', 'this endpoint has not been probed yet', true);
    } else if (DEAD_STATUSES.has(r.status)) {
      acc.block(
        'endpoint_dead',
        `the endpoint was ${r.status.replace('_', ' ')} when last checked${r.observedAt ? ` (${r.observedAt.toISOString().slice(0, 10)})` : ''}`,
      );
    } else if (r.status === 'blocked' || r.status === 'protocol_error' || r.status === 'timeout') {
      acc.unknown(
        'probe_inconclusive',
        `the last probe was inconclusive (${r.status.replace('_', ' ')})`,
        true,
      );
    }

    if (!acc.blockers.length) {
      evaluateAuth(r, client, acc);
      evaluateTools(server, client, acc);
    }
  } else {
    const p = server.package!;
    if (client.transports.stdio === 'no') {
      acc.block(
        'stdio_unsupported',
        `the server runs as a local ${p.registryType} package and ${client.name} cannot run local servers`,
      );
    } else if (client.transports.stdio === 'unknown') {
      acc.unknown(
        'stdio_unknown',
        `no source confirms ${client.name} can run local (stdio) servers`,
        true,
      );
    } else {
      if (client.transports.stdio === 'partial')
        acc.warn('stdio_partial', `${client.name} runs local servers only in some environments`);
      const required = p.env.filter((e) => e.required);
      if (required.length)
        acc.step(
          'set_env',
          `set ${required.map((e) => e.name).join(', ')} in the server's environment`,
        );
      evaluateTools(server, client, acc);
    }
  }

  const verdict: CompatVerdict = acc.blockers.length
    ? 'blocked'
    : acc.unknowns.some((u) => u.decisive)
      ? 'unknown'
      : acc.setup.length
        ? 'needs_setup'
        : 'works';
  return { client: client.id, clientName: client.name, verdict, via, ...acc };
}

export function evaluateClients(
  server: ServerFacts,
  clients: readonly ClientProfile[],
): ClientCompat[] {
  return clients.map((c) => evaluateClient(server, c));
}
