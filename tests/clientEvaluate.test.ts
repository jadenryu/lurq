import { describe, expect, it } from 'vitest';
import { evaluateClient, modelToolName, type ServerFacts } from '../src/clients/evaluate';
import { CLIENT_PROFILES } from '../src/clients/profiles';
import { placeholderFor, renderClientConfig } from '../src/clients/render';
import type { ClientProfile } from '../src/clients/types';
import type { AuthProfile, OAuthProfile } from '../src/remoteProbe/types';

/** A client that supports everything, to switch single capabilities off per test. */
function client(
  over: Partial<ClientProfile> = {},
  auth: Partial<ClientProfile['auth']> = {},
): ClientProfile {
  return {
    id: 'claude-code',
    name: 'TestClient',
    kind: 'cli',
    transports: { stdio: 'yes', streamableHttp: 'yes', sse: 'yes' },
    auth: {
      oauth: 'yes',
      dcr: 'yes',
      cimd: 'yes',
      preRegistered: 'no',
      staticHeaders: 'yes',
      redirectUris: ['https://client.dev/cb'],
      note: null,
      ...auth,
    },
    toolNaming: {
      format: 'mcp__{server}__{tool}',
      replacedChars: null,
      maxLength: 64,
      onOverflow: 'error',
    },
    toolLimits: { maxTools: null, scope: null, toolSearch: 'unknown' },
    schema: {
      rootCombinators: 'yes',
      rejectedKeywords: [],
      typeArrays: 'yes',
      onInvalid: 'unknown',
    },
    protocol: {
      revision: '2026-07-28',
      resources: 'yes',
      prompts: 'yes',
      sampling: 'no',
      elicitation: 'no',
    },
    config: { remote: null, addCommand: null, deeplink: null },
    availability: null,
    verifiedAt: '2026-09-15',
    sources: [],
    ...over,
  };
}

const oauth = (over: Partial<OAuthProfile> = {}): OAuthProfile => ({
  resourceMetadataUrl: 'https://mcp.x.dev/.well-known/oauth-protected-resource',
  resourceMetadataVia: 'well_known_root',
  resource: 'https://mcp.x.dev',
  authorizationServers: ['https://auth.x.dev'],
  scopesSupported: null,
  challengeScope: null,
  issuer: 'https://auth.x.dev',
  asMetadataUrl: 'https://auth.x.dev/.well-known/oauth-authorization-server',
  cimd: false,
  dcr: true,
  pkceS256: true,
  issParameter: null,
  ...over,
});

const TOOL = (
  name: string,
  inputSchema: Record<string, unknown> = { type: 'object', properties: {} },
) => ({ name, inputSchema });

function server(
  over: Partial<ServerFacts> = {},
  remote: Partial<NonNullable<ServerFacts['remote']>> = {},
): ServerFacts {
  return {
    name: 'io.x/weather',
    alias: 'weather',
    remote: {
      url: 'https://mcp.x.dev/mcp',
      transport: 'streamable-http',
      templated: false,
      status: 'open',
      observedAt: new Date('2026-09-15T00:00:00Z'),
      auth: { mode: 'none', challengeStatus: null, oauth: null, declaredHeaders: [] },
      violations: [],
      declaredHeaders: [],
      ...remote,
    },
    package: null,
    tools: [TOOL('forecast')],
    ...over,
  };
}

const withAuth = (
  auth: Partial<AuthProfile>,
  extra: Partial<NonNullable<ServerFacts['remote']>> = {},
) =>
  server(
    { tools: null },
    {
      status: 'auth_required',
      auth: { mode: 'oauth', challengeStatus: 401, oauth: oauth(), declaredHeaders: [], ...auth },
      ...extra,
    },
  );

describe('transport and endpoint health', () => {
  it('works for an open server in a capable client', () => {
    expect(evaluateClient(server(), client())).toMatchObject({
      verdict: 'works',
      via: 'remote',
      blockers: [],
    });
  });

  it('blocks an SSE-only server where SSE is unsupported, and warns where it is deprecated', () => {
    const sse = server({}, { transport: 'sse' });
    expect(
      evaluateClient(
        sse,
        client({ transports: { stdio: 'yes', streamableHttp: 'yes', sse: 'no' } }),
      ).blockers.map((b) => b.code),
    ).toEqual(['transport_unsupported']);
    expect(
      evaluateClient(
        sse,
        client({ transports: { stdio: 'yes', streamableHttp: 'yes', sse: 'partial' } }),
      ).warnings.map((w) => w.code),
    ).toContain('transport_partial');
  });

  it('blocks a dead endpoint for everyone, and says unknown when never probed', () => {
    expect(evaluateClient(server({}, { status: 'not_found' }), client()).verdict).toBe('blocked');
    expect(evaluateClient(server({}, { status: null, auth: null }), client()).verdict).toBe(
      'unknown',
    );
  });

  it('asks for placeholders to be filled on a templated URL', () => {
    const r = evaluateClient(
      server({}, { templated: true, status: null, url: 'https://{tenant}.x.dev/mcp' }),
      client(),
    );
    expect(r).toMatchObject({
      verdict: 'needs_setup',
      setup: [expect.objectContaining({ code: 'fill_url' })],
    });
  });

  it('routes a package-only server through stdio, or blocks it where stdio is impossible', () => {
    const pkg = server({
      remote: null,
      package: {
        registryType: 'npm',
        identifier: '@x/weather',
        env: [{ name: 'X_KEY', required: true, secret: true, description: null, format: null }],
      },
    });
    expect(evaluateClient(pkg, client())).toMatchObject({
      verdict: 'needs_setup',
      via: 'package',
      setup: [
        expect.objectContaining({ code: 'set_env', detail: expect.stringContaining('X_KEY') }),
      ],
    });
    expect(
      evaluateClient(
        pkg,
        client({ transports: { stdio: 'no', streamableHttp: 'yes', sse: 'yes' } }),
      ).blockers.map((b) => b.code),
    ).toEqual(['stdio_unsupported']);
  });
});

describe('auth', () => {
  it('blocks a hand-configured key where custom headers are impossible, and asks for it where possible', () => {
    const keyed = withAuth(
      { mode: 'static', oauth: null },
      { declaredHeaders: [{ name: 'X-API-Key', required: true, secret: true, description: null }] },
    );
    expect(
      evaluateClient(keyed, client({}, { staticHeaders: 'no' })).blockers.map((b) => b.code),
    ).toEqual(['no_static_headers']);
    const ok = evaluateClient(keyed, client());
    expect(ok.verdict).toBe('needs_setup');
    expect(ok.setup[0]!.detail).toMatch(/X-API-Key/);
  });

  it('matches OAuth registration methods between server and client', () => {
    const dcrOnly = withAuth({});
    expect(evaluateClient(dcrOnly, client()).verdict).toBe('works');
    expect(
      evaluateClient(dcrOnly, client({}, { dcr: 'no', cimd: 'yes' })).blockers.map((b) => b.code),
    ).toEqual(['no_shared_registration']);
    const pre = evaluateClient(
      dcrOnly,
      client({}, { dcr: 'no', cimd: 'yes', preRegistered: 'yes' }),
    );
    expect(pre.verdict).toBe('needs_setup');
    expect(pre.setup[0]!.detail).toMatch(/client\.dev\/cb/);
    expect(evaluateClient(dcrOnly, client({}, { dcr: 'unknown', cimd: 'yes' })).verdict).toBe(
      'unknown',
    );
  });

  it('blocks a missing PKCE advertisement only for clients that enforce it', () => {
    const noPkce = withAuth(
      { oauth: oauth({ pkceS256: false }) },
      { violations: [{ code: 'pkce_s256_not_advertised', detail: 'no S256' }] },
    );
    expect(
      evaluateClient(noPkce, client({}, { strict: { pkceS256Required: true } })).blockers.map(
        (b) => b.code,
      ),
    ).toEqual(['pkce_required']);
    expect(evaluateClient(noPkce, client()).verdict).toBe('works');
    expect(evaluateClient(noPkce, client()).warnings.map((w) => w.code)).toContain(
      'pkce_not_advertised',
    );
  });

  it('offers a token as a header where a client has no OAuth but can send headers', () => {
    const r = evaluateClient(withAuth({}), client({}, { oauth: 'no' }));
    expect(r.verdict).toBe('needs_setup');
    expect(
      evaluateClient(withAuth({}), client({}, { oauth: 'no', staticHeaders: 'no' })).verdict,
    ).toBe('blocked');
  });

  it('does not let an unreadable tool list decide the verdict', () => {
    const r = evaluateClient(withAuth({}), client());
    expect(r.unknowns).toEqual([
      expect.objectContaining({ code: 'tools_unread', decisive: false }),
    ]);
    expect(r.verdict).toBe('works');
  });
});

describe('tools', () => {
  const longName = 'get_the_current_weather_forecast_for_a_location_by_name_and_country';

  it('computes the name the model sees', () => {
    expect(modelToolName(client(), 'weather', 'forecast')).toBe('mcp__weather__forecast');
    expect(
      modelToolName(
        client({
          toolNaming: {
            format: 'mcp_{server}_{tool}',
            replacedChars: '[^A-Za-z0-9_]',
            maxLength: 64,
            onOverflow: 'truncate',
          },
        }),
        'my-srv',
        'a.b',
      ),
    ).toBe('mcp_my_srv_a_b');
  });

  it('blocks names past the limit where the client errors, and catches truncation collisions', () => {
    expect(
      evaluateClient(server({ tools: [TOOL(longName)] }), client()).blockers.map((b) => b.code),
    ).toEqual(['tool_name_too_long']);
    const truncating = client({
      toolNaming: {
        format: 'mcp__{server}__{tool}',
        replacedChars: null,
        maxLength: 40,
        onOverflow: 'truncate',
      },
    });
    const clash = server({ tools: [TOOL(`${longName}_a`), TOOL(`${longName}_b`)] });
    expect(evaluateClient(clash, truncating).blockers.map((b) => b.code)).toEqual([
      'tool_name_collision',
    ]);
    const single = server({ tools: [TOOL(longName)] });
    expect(evaluateClient(single, truncating).warnings.map((w) => w.code)).toContain(
      'tool_name_truncated',
    );
  });

  it('applies schema rules by what the client does with a bad schema', () => {
    const combinator = server({
      tools: [TOOL('pick', { anyOf: [{ type: 'object' }, { type: 'string' }] })],
    });
    const strict = client({
      schema: {
        rootCombinators: 'no',
        rejectedKeywords: [],
        typeArrays: 'yes',
        onInvalid: 'fail_request',
      },
    });
    expect(evaluateClient(combinator, strict).blockers.map((b) => b.code)).toEqual([
      'schema_rejected',
    ]);
    const dropping = client({
      schema: {
        rootCombinators: 'no',
        rejectedKeywords: [],
        typeArrays: 'yes',
        onInvalid: 'drop_tool',
      },
    });
    expect(evaluateClient(combinator, dropping).warnings.map((w) => w.code)).toContain(
      'schema_tool_dropped',
    );
  });

  it('warns past a documented tool cap unless the client defers tool loading', () => {
    const many = server({ tools: Array.from({ length: 130 }, (_, i) => TOOL(`t${i}`)) });
    expect(
      evaluateClient(
        many,
        client({ toolLimits: { maxTools: 128, scope: 'per_request', toolSearch: 'no' } }),
      ).warnings.map((w) => w.code),
    ).toContain('too_many_tools');
    expect(
      evaluateClient(
        many,
        client({ toolLimits: { maxTools: 128, scope: 'per_request', toolSearch: 'yes' } }),
      ).warnings.map((w) => w.code),
    ).not.toContain('too_many_tools');
  });
});

describe('against the shipped client profiles', () => {
  const byId = (id: string) => CLIENT_PROFILES.find((c) => c.id === id)!;

  it('covers every client with a verdict and never throws', () => {
    const facts = [
      server(),
      server({}, { transport: 'sse' }),
      withAuth({ mode: 'static', oauth: null }),
      withAuth({}),
      server({ remote: null, package: { registryType: 'npm', identifier: 'x', env: [] } }),
    ];
    for (const f of facts)
      for (const c of CLIENT_PROFILES)
        expect(['works', 'needs_setup', 'blocked', 'unknown']).toContain(
          evaluateClient(f, c).verdict,
        );
  });

  it('reflects documented facts: no local servers in claude.ai, no SSE in Codex', () => {
    const pkgOnly = server({
      remote: null,
      package: { registryType: 'npm', identifier: 'x', env: [] },
    });
    expect(evaluateClient(pkgOnly, byId('claude-ai')).verdict).toBe('blocked');
    expect(evaluateClient(server({}, { transport: 'sse' }), byId('codex')).verdict).toBe('blocked');
    expect(evaluateClient(server(), byId('claude-code')).verdict).toBe('works');
  });
});

describe('renderClientConfig', () => {
  const byId = (id: string) => CLIENT_PROFILES.find((c) => c.id === id)!;
  const input = { name: 'weather', url: 'https://mcp.x.dev/mcp', headers: ['Authorization'] };

  it('renders each client’s own keys, with placeholder values only', () => {
    const cc = renderClientConfig(byId('claude-code'), input);
    const json = JSON.parse(cc.find((r) => r.kind === 'json')!.text);
    expect(json).toEqual({
      mcpServers: {
        weather: {
          type: 'http',
          url: 'https://mcp.x.dev/mcp',
          headers: { Authorization: 'Bearer <your-token>' },
        },
      },
    });
    expect(cc.find((r) => r.kind === 'command')!.text).toBe(
      'claude mcp add --transport http weather https://mcp.x.dev/mcp --header "Authorization: Bearer <your-token>"',
    );

    const vscode = renderClientConfig(byId('vscode'), input);
    expect(JSON.parse(vscode.find((r) => r.kind === 'json')!.text)).toHaveProperty(
      'servers.weather.type',
      'http',
    );
    const link = vscode.find((r) => r.kind === 'deeplink')!.text;
    expect(JSON.parse(decodeURIComponent(link.slice('vscode:mcp/install?'.length)))).toMatchObject({
      name: 'weather',
      url: 'https://mcp.x.dev/mcp',
    });

    const codex = renderClientConfig(byId('codex'), input).find((r) => r.kind === 'toml')!;
    expect(codex.text).toContain('[mcp_servers.weather]');
    expect(codex.text).toContain('url = "https://mcp.x.dev/mcp"');

    const cursorLink = renderClientConfig(byId('cursor'), input).find(
      (r) => r.kind === 'deeplink',
    )!.text;
    const cfg = new URL(cursorLink).searchParams.get('config')!;
    expect(JSON.parse(Buffer.from(cfg, 'base64').toString())).toEqual({
      url: 'https://mcp.x.dev/mcp',
      headers: { Authorization: 'Bearer <your-token>' },
    });
  });

  it('omits the header flag when there is nothing to send, and never emits a real-looking secret', () => {
    const cmd = renderClientConfig(byId('claude-code'), { ...input, headers: [] }).find(
      (r) => r.kind === 'command',
    )!;
    expect(cmd.text).toBe('claude mcp add --transport http weather https://mcp.x.dev/mcp');
    expect(placeholderFor('X-API-Key')).toBe('<your-x-api-key>');
  });
});
