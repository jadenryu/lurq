/**
 * MCP client constraint profiles, transcribed from primary sources (vendor docs, vendor source code,
 * vendor issue trackers) read on 2026-09-15.
 *
 * Every entry cites its sources. `unknown` means no primary source confirmed the fact, not that the
 * client lacks it. To update an entry: re-read its sources (and any new ones), change only what they
 * confirm, add the new sources, and set `verifiedAt` to the date you read them.
 */

import type { ClientProfile } from './types';

export const CLIENT_PROFILES: readonly ClientProfile[] = [
  {
    id: 'claude-code',
    name: 'Claude Code',
    kind: 'cli',
    transports: {
      stdio: 'yes',
      streamableHttp: 'yes',
      sse: 'partial',
    },
    auth: {
      oauth: 'yes',
      dcr: 'yes',
      cimd: 'yes',
      preRegistered: 'yes',
      staticHeaders: 'yes',
      redirectUris: ['http://localhost:{port}/callback', 'http://127.0.0.1:{port}/callback'],
      note: 'Authorization servers must accept both localhost and 127.0.0.1 loopback callbacks on any port, since the port is random unless --callback-port pins it.',
    },
    toolNaming: {
      format: 'mcp__{server}__{tool}',
      replacedChars: null,
      maxLength: 128,
      onOverflow: 'unknown',
    },
    toolLimits: {
      maxTools: null,
      scope: null,
      toolSearch: 'yes',
    },
    schema: {
      rootCombinators: 'partial',
      rejectedKeywords: [],
      typeArrays: 'unknown',
      onInvalid: 'drop_tool',
    },
    protocol: {
      revision: '2026-07-28',
      resources: 'yes',
      prompts: 'yes',
      sampling: 'unknown',
      elicitation: 'yes',
    },
    config: {
      remote: {
        file: '.mcp.json or ~/.claude.json',
        containerKey: 'mcpServers',
        typeKey: 'type',
        typeValue: 'http',
        urlKey: 'url',
        headersKey: 'headers',
      },
      addCommand: 'claude mcp add --transport http {name} {url} --header "{header}"',
      deeplink: null,
    },
    availability:
      'Local MCP has no plan gating; managed settings (managed-mcp.json, allowedMcpServers/deniedMcpServers) can block servers.',
    verifiedAt: '2026-09-15',
    sources: [
      {
        url: 'https://code.claude.com/docs/en/mcp',
        fact: 'transports stdio/http/sse(deprecated)/ws; ws not in --transport and header-only auth; url without type is an error',
      },
      {
        url: 'https://code.claude.com/docs/en/mcp',
        fact: 'claude mcp add syntax, --header, --env, --scope, --client-id/--client-secret/--callback-port, add-json, add-from-claude-desktop',
      },
      {
        url: 'https://code.claude.com/docs/en/mcp',
        fact: 'config files .mcp.json, ~/.claude.json, managed-mcp.json; mcpServers key; entry keys incl. headersHelper, oauth, alwaysLoad, timeout',
      },
      {
        url: 'https://code.claude.com/docs/en/mcp',
        fact: '${VAR} and ${VAR:-default} expansion locations; credential env vars read as empty in url/headers',
      },
      {
        url: 'https://code.claude.com/docs/en/mcp',
        fact: 'DCR default; CIMD supported and discovered automatically; redirect http://localhost:PORT/callback; v2.1.229 127.0.0.1 regression fixed in v2.1.231',
      },
      {
        url: 'https://code.claude.com/docs/en/mcp',
        fact: 'plugin tool name mcp__plugin_<plugin>_<server>__<tool>, invalid chars -> _; server names limited to letters/numbers/-/_',
      },
      {
        url: 'https://code.claude.com/docs/en/mcp',
        fact: 'MAX_MCP_OUTPUT_TOKENS default 25,000, warning at 10,000; anthropic/maxResultSizeChars up to 500,000 chars',
      },
      {
        url: 'https://code.claude.com/docs/en/mcp',
        fact: 'tool search on by default, ENABLE_TOOL_SEARCH values, auto = 10% threshold, alwaysLoad, no fixed per-server cap, descriptions/instructions truncated at 2KB',
      },
      {
        url: 'https://code.claude.com/docs/en/mcp',
        fact: 'root-level anyOf/oneOf/allOf flattened (v2.1.195+); property names 1-64 [A-Za-z0-9_.-]; draft 2020-12 meta-schema check; invalid tools excluded (v2.1.216+)',
      },
      {
        url: 'https://code.claude.com/docs/en/mcp',
        fact: 'resources via @ mentions, prompts as /server:prompt, elicitation form/URL, roots/list, list_changed, anthropic/requiresUserInteraction',
      },
      {
        url: 'https://code.claude.com/docs/en/mcp',
        fact: 'v1/v2 runtimes; v2 = TS SDK 2.0 with revision 2026-07-28; MCP_SDK_GENERATION, MCP_PROTOCOL_NEGOTIATION',
      },
      {
        url: 'https://code.claude.com/docs/en/mcp',
        fact: 'claude.ai connectors only with a claude.ai subscription login; allowedMcpServers/deniedMcpServers; ENABLE_CLAUDEAI_MCP_SERVERS; managedMcpServers precedence v2.1.259+',
      },
      {
        url: 'https://code.claude.com/docs/en/changelog',
        fact: 'Support MCP structuredContent field in tool responses; CIMD (SEP-991) support added; http entries fall back to legacy SSE',
      },
      {
        url: 'https://claude.com/docs/connectors/building/authentication',
        fact: 'Claude Code uses RFC 8252 loopback redirect on ephemeral port; CIMD declares http://localhost/callback and http://127.0.0.1/callback; does not use Anthropic-held creds; PKCE S256',
      },
      {
        url: 'https://platform.claude.com/docs/en/agents-and-tools/tool-use/define-tools',
        fact: 'Claude API tool name regex ^[a-zA-Z0-9_-]{1,128}$',
      },
    ],
  },
  {
    id: 'claude-desktop',
    name: 'Claude Desktop',
    kind: 'desktop',
    transports: {
      stdio: 'yes',
      streamableHttp: 'yes',
      sse: 'partial',
    },
    auth: {
      oauth: 'yes',
      dcr: 'yes',
      cimd: 'yes',
      preRegistered: 'yes',
      staticHeaders: 'partial',
      redirectUris: ['https://claude.ai/api/mcp/auth_callback', 'http://127.0.0.1:53280/callback'],
      note: "Remote servers are added as connectors that connect from Anthropic's cloud (160.79.104.0/21), and request headers are an admin-set beta (max 4) that cannot carry Authorization on an OAuth connection.",
    },
    toolNaming: {
      format: null,
      replacedChars: null,
      maxLength: null,
      onOverflow: 'unknown',
    },
    toolLimits: {
      maxTools: null,
      scope: null,
      toolSearch: 'unknown',
    },
    schema: {
      rootCombinators: 'unknown',
      rejectedKeywords: [],
      typeArrays: 'unknown',
      onInvalid: 'unknown',
    },
    protocol: {
      revision: null,
      resources: 'yes',
      prompts: 'yes',
      sampling: 'no',
      elicitation: 'unknown',
    },
    config: {
      remote: null,
      addCommand: null,
      deeplink: null,
    },
    availability: 'Custom connectors on Free (one), Pro, Max, Team and Enterprise; on Team/Enterprise only Owners add them.',
    verifiedAt: '2026-09-15',
    sources: [
      {
        url: 'https://modelcontextprotocol.io/docs/develop/connect-local-servers',
        fact: 'claude_desktop_config.json paths macOS/Windows, mcpServers command/args/env, Settings > Developer > Edit Config, restart, log paths',
      },
      {
        url: 'https://modelcontextprotocol.io/docs/develop/connect-remote-servers',
        fact: 'remote servers added via Settings > Connectors > Add custom connector in Desktop or browser; resources and prompts selectable in the attach menu',
      },
      {
        url: 'https://claude.com/docs/connectors/building/authentication',
        fact: 'DCR/CIMD out of the box, CIMD selection conditions, static_headers beta, callback https://claude.ai/api/mcp/auth_callback for Desktop, PKCE S256, 10s/30s endpoint latency, egress 160.79.104.0/21',
      },
      {
        url: 'https://claude.com/docs/connectors/custom/remote-mcp',
        fact: 'Add custom connector dialog: CIMD/DCR/own client, request headers up to four, header approval, /sse selects SSE, auth settings immutable after add',
      },
      {
        url: 'https://claude.com/docs/connectors/building/index',
        fact: 'Streamable HTTP and legacy SSE (deprecating); tools/prompts/resources, text+image results, text+binary resources; subscriptions & sampling not yet supported; ~150,000 char result; 240s timeout',
      },
      {
        url: 'https://claude.com/docs/connectors/building/mcpb',
        fact: '.mcpb zip with manifest.json, stdio, user_config UI, mcpb CLI, macOS/Windows',
      },
      {
        url: 'https://claude.com/docs/connectors/building/review-criteria',
        fact: 'tool names <= 64 chars; title + readOnlyHint/destructiveHint required and drive auto-permissions',
      },
      {
        url: 'https://claude.com/docs/connectors/overview',
        fact: 'Claude Desktop: Full MCP support and local desktop extensions',
      },
      {
        url: 'https://claude.com/docs/third-party/claude-desktop/extensions',
        fact: '3P managedMcpServers (http/sse/stdio), fixed OAuth loopback http://127.0.0.1:53280/callback, headersHelper 30s',
      },
      {
        url: 'https://support.claude.com/en/articles/10949351-getting-started-with-local-mcp-servers-on-claude-desktop',
        fact: 'Settings > Extensions install flow; Team/Enterprise owner controls for extensions',
      },
      {
        url: 'https://support.claude.com/en/articles/11175166-getting-started-with-custom-connectors-using-remote-mcp',
        fact: 'custom connectors on Free (1), Pro, Max, Team, Enterprise; only Owners add on Team/Enterprise',
      },
      {
        url: 'https://github.com/webflow/mcp-server/issues/73',
        fact: 'CORROBORATION ONLY (non-vendor): Desktop does not connect to remote servers configured in claude_desktop_config.json',
      },
    ],
  },
  {
    id: 'claude-ai',
    name: 'Claude.ai',
    kind: 'web',
    transports: {
      stdio: 'no',
      streamableHttp: 'yes',
      sse: 'partial',
    },
    auth: {
      oauth: 'yes',
      dcr: 'yes',
      cimd: 'yes',
      preRegistered: 'yes',
      staticHeaders: 'partial',
      redirectUris: ['https://claude.ai/api/mcp/auth_callback'],
      note: 'Request headers are an admin-set beta for limited orgs (max 4) that cannot be combined with OAuth, and the server must be publicly reachable over IPv4 from 160.79.104.0/21.',
    },
    toolNaming: {
      format: null,
      replacedChars: null,
      maxLength: null,
      onOverflow: 'unknown',
    },
    toolLimits: {
      maxTools: null,
      scope: null,
      toolSearch: 'unknown',
    },
    schema: {
      rootCombinators: 'unknown',
      rejectedKeywords: [],
      typeArrays: 'unknown',
      onInvalid: 'unknown',
    },
    protocol: {
      revision: null,
      resources: 'yes',
      prompts: 'yes',
      sampling: 'no',
      elicitation: 'unknown',
    },
    config: {
      remote: null,
      addCommand: null,
      deeplink: null,
    },
    availability: 'Free (one custom connector), Pro, Max, Team and Enterprise; on Team/Enterprise only Owners add connectors.',
    verifiedAt: '2026-09-15',
    sources: [
      {
        url: 'https://support.claude.com/en/articles/11175166-getting-started-with-custom-connectors-using-remote-mcp',
        fact: 'Free/Pro/Max/Team/Enterprise; Free limited to one; Owners only on Team/Enterprise; Advanced settings OAuth Client ID/Secret; reachable from Anthropic IP ranges',
      },
      {
        url: 'https://support.claude.com/en/articles/11176164-use-connectors-to-extend-claude-s-capabilities',
        fact: 'connectors on web, Desktop, Cowork, iOS, Android; installing connectors on mobile is beta',
      },
      {
        url: 'https://claude.com/docs/connectors/building/authentication',
        fact: 'auth types oauth_dcr/oauth_cimd/oauth_anthropic_creds/custom_connection/static_headers(beta)/none; CIMD selection rule; PKCE S256; callback https://claude.ai/api/mcp/auth_callback; 401+resource_metadata; token refresh; 10s/30s latency; client_credentials unsupported',
      },
      {
        url: 'https://claude.com/docs/connectors/custom/remote-mcp',
        fact: 'UI paths per plan, dialog fields, request headers beta up to four, header name approval, no Authorization header with OAuth, /sse selects SSE, auth immutable after add',
      },
      {
        url: 'https://claude.com/docs/connectors/building/index',
        fact: 'Streamable HTTP + legacy SSE (deprecating); auth specs 2025-03-26/2025-06-18/2025-11-25; tools/prompts/resources; subscriptions, sampling, draft capabilities not yet supported; ~150k char results; 240s timeout',
      },
      {
        url: 'https://claude.com/docs/connectors/building/troubleshooting',
        fact: 'IPv4-only, all resolved addresses must be public; RFC 8707 resource param; cross-host redirect drops Authorization header',
      },
      {
        url: 'https://claude.com/docs/connectors/building/review-criteria',
        fact: 'tool names <= 64 chars; title + readOnlyHint/destructiveHint required',
      },
      {
        url: 'https://claude.com/docs/connectors/building/testing',
        fact: 'any plan can add a custom connector for testing; clientInfo name varies (claude-ai / Anthropic / claude-code)',
      },
      {
        url: 'https://claude.com/docs/connectors/overview',
        fact: 'Claude.ai full remote MCP & MCP Apps; Mobile remote MCP access',
      },
      {
        url: 'https://platform.claude.com/docs/en/api/ip-addresses',
        fact: 'outbound IPv4 160.79.104.0/21 for MCP tool calls',
      },
    ],
  },
  {
    id: 'claude-api',
    name: 'Claude API MCP connector',
    kind: 'api',
    transports: {
      stdio: 'no',
      streamableHttp: 'yes',
      sse: 'yes',
    },
    auth: {
      oauth: 'no',
      dcr: 'no',
      cimd: 'no',
      preRegistered: 'no',
      staticHeaders: 'partial',
      redirectUris: [],
      note: 'The caller runs OAuth and passes the access token as authorization_token; no other request headers are documented.',
    },
    toolNaming: {
      format: '{tool}',
      replacedChars: null,
      maxLength: null,
      onOverflow: 'unknown',
    },
    toolLimits: {
      maxTools: null,
      scope: null,
      toolSearch: 'yes',
    },
    schema: {
      rootCombinators: 'no',
      rejectedKeywords: [],
      typeArrays: 'unknown',
      onInvalid: 'unknown',
    },
    protocol: {
      revision: null,
      resources: 'no',
      prompts: 'no',
      sampling: 'no',
      elicitation: 'no',
    },
    config: {
      remote: null,
      addCommand: null,
      deeplink: null,
    },
    availability:
      'Beta (anthropic-beta: mcp-client-2025-11-20) on the Claude API, Claude Platform on AWS and Microsoft Foundry; not on Amazon Bedrock or Google Cloud, and not ZDR-eligible.',
    verifiedAt: '2026-09-15',
    sources: [
      {
        url: 'https://platform.claude.com/docs/en/agents-and-tools/mcp-connector',
        fact: 'beta header mcp-client-2025-11-20, 2025-04-04 deprecated; Beta; ZDR not eligible; platforms Claude API/AWS/Foundry, not Bedrock/Google Cloud',
      },
      {
        url: 'https://platform.claude.com/docs/en/agents-and-tools/mcp-connector',
        fact: 'only tool calls supported; Streamable HTTP and SSE; no local STDIO; url must start with https://',
      },
      {
        url: 'https://platform.claude.com/docs/en/agents-and-tools/mcp-connector',
        fact: 'mcp_servers fields type/url/name/authorization_token; mcp_toolset default_config/configs/enabled/defer_loading/cache_control; validation rules; unknown tool names only warn',
      },
      {
        url: 'https://platform.claude.com/docs/en/agents-and-tools/mcp-connector',
        fact: 'API consumers handle OAuth and token refresh; mcp_tool_use/mcp_tool_result blocks with server_name; Batches supported; SDK helpers for prompts/resources/local servers',
      },
      {
        url: 'https://platform.claude.com/docs/en/agents-and-tools/tool-use/tool-search-tool',
        fact: 'tool_search_tool_regex_20251119 / bm25; defer_loading; at least one non-deferred tool; up to 5 tool_reference results by default',
      },
      {
        url: 'https://platform.claude.com/docs/en/agents-and-tools/tool-use/define-tools',
        fact: 'tool name regex ^[a-zA-Z0-9_-]{1,128}$',
      },
      {
        url: 'https://platform.claude.com/docs/en/build-with-claude/structured-outputs',
        fact: 'strict tool use JSON Schema limitations (no recursion, no min/max/length, additionalProperties false, minItems 0/1, regex limits, 400 on unsupported)',
      },
      {
        url: 'https://code.claude.com/docs/en/mcp',
        fact: 'Claude API rejects root-level anyOf/oneOf/allOf; property names 1-64; whole request 400 on one invalid schema',
      },
      {
        url: 'https://platform.claude.com/docs/en/api/ip-addresses',
        fact: 'outbound 160.79.104.0/21 for MCP connector calls',
      },
    ],
  },
  {
    id: 'chatgpt',
    name: 'ChatGPT',
    kind: 'web',
    transports: {
      stdio: 'no',
      streamableHttp: 'yes',
      sse: 'partial',
    },
    auth: {
      oauth: 'yes',
      dcr: 'yes',
      cimd: 'yes',
      preRegistered: 'yes',
      staticHeaders: 'unknown',
      redirectUris: [
        'https://chatgpt.com/connector_platform_oauth_redirect',
        'https://chatgpt.com/connector/oauth/{callback_id}',
      ],
      note: 'The authorization server must advertise S256 in code_challenge_methods_supported or ChatGPT will not connect.',
    },
    toolNaming: {
      format: null,
      replacedChars: null,
      maxLength: null,
      onOverflow: 'unknown',
    },
    toolLimits: {
      maxTools: null,
      scope: null,
      toolSearch: 'unknown',
    },
    schema: {
      rootCombinators: 'unknown',
      rejectedKeywords: [],
      typeArrays: 'unknown',
      onInvalid: 'unknown',
    },
    protocol: {
      revision: null,
      resources: 'partial',
      prompts: 'unknown',
      sampling: 'unknown',
      elicitation: 'unknown',
    },
    config: {
      remote: null,
      addCommand: null,
      deeplink: null,
    },
    availability:
      'Developer mode on Pro, Plus, Business, Enterprise and Education (web only); Business/Enterprise/Edu workspace admins must enable it.',
    verifiedAt: '2026-09-15',
    sources: [
      {
        url: 'https://developers.openai.com/api/docs/guides/developer-mode',
        fact: 'Plans Pro/Plus/Business/Enterprise/Education on web; transports SSE and streaming HTTP; auth OAuth/No Auth/Mixed; readOnlyHint respected; toggle/refresh tools; instructions 512 chars',
      },
      {
        url: 'https://developers.openai.com/apps-sdk/build/auth',
        fact: 'PKCE S256 required; CIMD preferred with chatgpt.com client.json URLs; DCR alternative; predefined OAuth client option; redirect URIs; RFC 9728/8414; resource param; RFC 9207 iss; token endpoint auth methods; securitySchemes; mcp/www_authenticate; cites MCP auth 2025-11-25 and 2026-07-28',
      },
      {
        url: 'https://developers.openai.com/apps-sdk/reference',
        fact: '_meta keys (openai/outputTemplate, ui.resourceUri, fileParams), annotations readOnlyHint/destructiveHint/openWorldHint required, structuredContent/content/_meta audiences',
      },
      {
        url: 'https://developers.openai.com/apps-sdk/mcp-apps-in-chatgpt',
        fact: 'ChatGPT implements MCP Apps standard; text/html;profile=mcp-app; _meta.ui.resourceUri',
      },
      {
        url: 'https://developers.openai.com/plugins/build/mcp-server',
        fact: 'Streamable HTTP transport; structuredContent + content; annotations; instructions first 512 chars; elicitation mentioned',
      },
      {
        url: 'https://developers.openai.com/apps-sdk/deploy/connect-chatgpt',
        fact: 'Public HTTPS /mcp endpoint or Secure MCP Tunnel (dev only); Refresh after tool changes in developer mode',
      },
      {
        url: 'https://help.openai.com/en/articles/11509118-admin-controls-security-and-compliance-in-apps-enterprise-edu-and-business',
        fact: 'Workspace admin enablement and Enterprise/Edu RBAC for developer mode (search snippet only; direct fetch returned 403)',
      },
      {
        url: 'https://help.openai.com/en/articles/12584461-developer-mode-and-mcp-apps-in-chatgpt',
        fact: 'Help article on developer mode (direct fetch 403; not used as sole source)',
      },
    ],
  },
  {
    id: 'openai-responses',
    name: 'OpenAI Responses API',
    kind: 'api',
    transports: {
      stdio: 'no',
      streamableHttp: 'yes',
      sse: 'yes',
    },
    auth: {
      oauth: 'no',
      dcr: 'no',
      cimd: 'no',
      preRegistered: 'no',
      staticHeaders: 'yes',
      redirectUris: [],
      note: 'The caller runs OAuth itself and must resend the access token in `authorization` on every request, since it is not stored.',
    },
    toolNaming: {
      format: null,
      replacedChars: null,
      maxLength: null,
      onOverflow: 'unknown',
    },
    toolLimits: {
      maxTools: null,
      scope: null,
      toolSearch: 'partial',
    },
    schema: {
      rootCombinators: 'unknown',
      rejectedKeywords: [],
      typeArrays: 'unknown',
      onInvalid: 'unknown',
    },
    protocol: {
      revision: null,
      resources: 'unknown',
      prompts: 'unknown',
      sampling: 'unknown',
      elicitation: 'unknown',
    },
    config: {
      remote: null,
      addCommand: null,
      deeplink: null,
    },
    availability: null,
    verifiedAt: '2026-09-15',
    sources: [
      {
        url: 'https://developers.openai.com/api/docs/guides/tools-connectors-mcp',
        fact: 'Streamable HTTP or HTTP/SSE; params; authorization not stored; app must handle OAuth; mcp_list_tools caching; defer_loading with tool search; 8 connectors; ZDR',
      },
      {
        url: 'https://developers.openai.com/api/reference/resources/responses/methods/create',
        fact: 'mcp tool fields: headers map, defer_loading, tunnel_id, connector_id enum, authorization text, allowed_tools filter with read_only matching readOnlyHint, require_approval',
      },
      {
        url: 'https://developers.openai.com/api/reference/resources/chat/subresources/completions/methods/create',
        fact: 'Function name: a-z, A-Z, 0-9, underscores and dashes, max length 64',
      },
      {
        url: 'https://developers.openai.com/api/docs/guides/function-calling',
        fact: 'strict mode requirements; rejected on violation; <20 functions soft guidance; tool_search only gpt-5.4+; defer_loading/namespaces',
      },
      {
        url: 'https://developers.openai.com/api/docs/guides/structured-outputs',
        fact: 'Supported types/properties/format list; unsupported composition keywords; size/nesting/enum limits; $defs and recursion supported; error on unsupported schema',
      },
    ],
  },
  {
    id: 'codex',
    name: 'Codex',
    kind: 'cli',
    transports: {
      stdio: 'yes',
      streamableHttp: 'yes',
      sse: 'no',
    },
    auth: {
      oauth: 'yes',
      dcr: 'yes',
      cimd: 'yes',
      preRegistered: 'partial',
      staticHeaders: 'yes',
      redirectUris: ['http://127.0.0.1:{port}/callback'],
      note: 'Authorization servers that advertise issuer identification must return a matching iss (RFC 9207) or Codex rejects the response.',
    },
    toolNaming: {
      format: 'mcp__{server}__{tool}',
      replacedChars: '[^A-Za-z0-9_]',
      maxLength: 128,
      onOverflow: 'truncate_hash',
    },
    toolLimits: {
      maxTools: null,
      scope: null,
      toolSearch: 'partial',
    },
    schema: {
      rootCombinators: 'unknown',
      rejectedKeywords: [],
      typeArrays: 'unknown',
      onInvalid: 'unknown',
    },
    protocol: {
      revision: '2025-11-25',
      resources: 'yes',
      prompts: 'unknown',
      sampling: 'no',
      elicitation: 'partial',
    },
    config: {
      remote: {
        file: '~/.codex/config.toml or .codex/config.toml',
        containerKey: 'mcp_servers',
        typeKey: null,
        typeValue: null,
        urlKey: 'url',
        headersKey: 'http_headers',
      },
      addCommand: 'codex mcp add {name} --url {url}',
      deeplink: null,
    },
    availability: null,
    verifiedAt: '2026-09-15',
    sources: [
      {
        url: 'https://learn.chatgpt.com/docs/extend/mcp?surface=cli',
        fact: 'STDIO + Streamable HTTP; config paths; shared by desktop app/CLI/IDE; config keys; bearer, OAuth CIMD/DCR, ChatGPT session auth; codex mcp add/login/list',
      },
      {
        url: 'https://github.com/openai/codex/blob/main/codex-rs/codex-mcp/src/tools.rs',
        fact: 'Source code: mcp__ prefix, __ delimiter, MAX_TOOL_NAME_LENGTH 128, SHA-1 12-hex suffix on collision/overflow, duplicate skip',
      },
      {
        url: 'https://github.com/openai/codex/blob/main/codex-rs/codex-mcp/src/mcp/mod.rs',
        fact: 'Source code: sanitize_responses_api_tool_name keeps only ASCII alphanumeric and _',
      },
      {
        url: 'https://github.com/openai/codex/blob/main/codex-rs/core/config.schema.json',
        fact: 'Source code: RawMcpServerConfig keys; McpServerAuth oauth/chatgpt/ema_auth; mcp_oauth_callback_port/url; credentials store; tool_search flags; non_prefixed_mcp_tool_names; omit_tools_from surfaces',
      },
      {
        url: 'https://github.com/openai/codex/blob/main/codex-rs/cli/src/mcp_cmd.rs',
        fact: 'Source code: codex mcp add usage and flags incl. --oauth-client-registration AUTO|CIMD|DCR',
      },
      {
        url: 'https://github.com/openai/codex/blob/main/codex-rs/rmcp-client/src/oauth_callback.rs',
        fact: 'Source code: default callback http://127.0.0.1/callback; cites MCP 2026-07-28 authorization response validation',
      },
      {
        url: 'https://github.com/openai/codex/blob/main/codex-rs/rmcp-client/src/rmcp_client.rs',
        fact: 'Source code: Streamable HTTP transports only; elicitation service; no sampling handler',
      },
      {
        url: 'https://github.com/openai/codex/blob/main/codex-rs/Cargo.toml',
        fact: 'Source code: rmcp = =3.2.0',
      },
      {
        url: 'https://github.com/modelcontextprotocol/rust-sdk/blob/rmcp-v3.2.0/crates/rmcp/src/model.rs',
        fact: 'Source code: ProtocolVersion::LATEST = V_2025_11_25; V_2026_07_28 defined',
      },
      {
        url: 'https://github.com/openai/codex/pull/17043',
        fact: 'MCP elicitation for custom servers merged 2026-04-08',
      },
      {
        url: 'https://github.com/openai/codex/issues/45621',
        fact: 'app-server auto-declines downstream MCP elicitation (issue title; status not verified)',
      },
      {
        url: 'https://github.com/openai/codex/blob/main/codex-rs/core/src/tools/handlers/mcp_resource.rs',
        fact: 'Source code: list_mcp_resources / list_mcp_resource_templates / read_mcp_resource handlers',
      },
      {
        url: 'https://developers.openai.com/apps-sdk/build/auth',
        fact: 'ChatGPT and Codex reject missing/mismatched iss when issuer identification advertised',
      },
    ],
  },
  {
    id: 'gemini-cli',
    name: 'Gemini CLI',
    kind: 'cli',
    transports: {
      stdio: 'yes',
      streamableHttp: 'yes',
      sse: 'yes',
    },
    auth: {
      oauth: 'yes',
      dcr: 'yes',
      cimd: 'unknown',
      preRegistered: 'yes',
      staticHeaders: 'yes',
      redirectUris: ['http://localhost:{port}/oauth/callback'],
      note: 'Authorization servers must return an iss matching the issuer (RFC 9207) or Gemini CLI rejects the response.',
    },
    toolNaming: {
      format: 'mcp_{server}_{tool}',
      replacedChars: '[^A-Za-z0-9_.:-]',
      maxLength: 63,
      onOverflow: 'truncate',
    },
    toolLimits: {
      maxTools: null,
      scope: null,
      toolSearch: 'unknown',
    },
    schema: {
      rootCombinators: 'unknown',
      rejectedKeywords: [],
      typeArrays: 'unknown',
      onInvalid: 'sanitize',
    },
    protocol: {
      revision: '2025-06-18',
      resources: 'yes',
      prompts: 'yes',
      sampling: 'no',
      elicitation: 'no',
    },
    config: {
      remote: {
        file: '~/.gemini/settings.json or .gemini/settings.json',
        containerKey: 'mcpServers',
        typeKey: null,
        typeValue: null,
        urlKey: 'httpUrl',
        headersKey: 'headers',
      },
      addCommand: 'gemini mcp add --transport http --header "{header}" {name} {url}',
      deeplink: null,
    },
    availability: null,
    verifiedAt: '2026-09-15',
    sources: [
      {
        url: 'https://github.com/google-gemini/gemini-cli/blob/main/docs/tools/mcp-server.md',
        fact: 'Source code: config keys, transports, env interpolation, mcp_{server}_{tool} FQN, char sanitization, 63-char truncation, underscore warning, last-registered-wins, schema sanitization, OAuth discovery/DCR, localhost callback, RFC 9207, token path, /mcp auth, prompts/resources, gemini mcp add/list/remove, extension merge',
      },
      {
        url: 'https://github.com/google-gemini/gemini-cli/blob/main/packages/core/src/tools/mcp-tool.ts',
        fact: "Source code: MAX_FUNCTION_NAME_LENGTH 64; regex ^[a-zA-Z_][a-zA-Z0-9_\\-.:]{0,63}$; slice(0,30)+'...'+slice(-30); parametersJsonSchema = inputSchema; content block transforms",
      },
      {
        url: 'https://github.com/google-gemini/gemini-cli/blob/main/packages/core/src/tools/mcp-client.ts',
        fact: 'Source code: SSE + StreamableHTTP transports, SSE fallback, roots capability, list_changed handlers, readOnlyHint, includeTools/excludeTools, no sampling/elicitation handlers',
      },
      {
        url: 'https://github.com/google-gemini/gemini-cli/blob/main/packages/core/src/mcp/oauth-provider.ts',
        fact: 'Source code: DCR via registration_endpoint; no CIMD code found',
      },
      {
        url: 'https://github.com/google-gemini/gemini-cli/blob/main/package.json',
        fact: 'Source code: @modelcontextprotocol/sdk 1.23.0 (version 0.62.0-nightly.20260915)',
      },
      {
        url: 'https://unpkg.com/@modelcontextprotocol/sdk@1.23.0/dist/esm/types.js',
        fact: 'Source code: LATEST_PROTOCOL_VERSION = 2025-06-18',
      },
      {
        url: 'https://github.com/google-gemini/gemini-cli/issues/22249',
        fact: "Elicitation unsupported, 'Method not found'; open, p2, opened 2026-03-13",
      },
      {
        url: 'https://github.com/google-gemini/gemini-cli/issues/7056',
        fact: 'MCP prompt workflow reported incomplete',
      },
      {
        url: 'https://ai.google.dev/gemini-api/docs/function-calling',
        fact: 'Only subset of OpenAPI schema supported; names without spaces/special chars; keep active set 10-20 tools',
      },
      {
        url: 'https://ai.google.dev/gemini-api/docs/generate-content/function-calling',
        fact: 'API may reject very large or deeply nested schemas; reduce number of declarations',
      },
    ],
  },
  {
    id: 'cursor',
    name: 'Cursor',
    kind: 'ide',
    transports: {
      stdio: 'yes',
      streamableHttp: 'yes',
      sse: 'yes',
    },
    auth: {
      oauth: 'yes',
      dcr: 'yes',
      cimd: 'unknown',
      preRegistered: 'yes',
      staticHeaders: 'yes',
      redirectUris: ['https://www.cursor.com/agents/mcp/oauth/callback', 'http://localhost:8787/callback'],
      note: null,
    },
    toolNaming: {
      format: null,
      replacedChars: null,
      maxLength: 60,
      onOverflow: 'unknown',
    },
    toolLimits: {
      maxTools: null,
      scope: null,
      toolSearch: 'yes',
    },
    schema: {
      rootCombinators: 'unknown',
      rejectedKeywords: [],
      typeArrays: 'unknown',
      onInvalid: 'unknown',
    },
    protocol: {
      revision: null,
      resources: 'yes',
      prompts: 'yes',
      sampling: 'unknown',
      elicitation: 'yes',
    },
    config: {
      remote: {
        file: '~/.cursor/mcp.json or .cursor/mcp.json',
        containerKey: 'mcpServers',
        typeKey: null,
        typeValue: null,
        urlKey: 'url',
        headersKey: 'headers',
      },
      addCommand: null,
      deeplink: 'cursor://anysphere.cursor-deeplink/mcp/install?name={name}&config={config}',
    },
    availability:
      'No plan gate for MCP; Enterprise admins can restrict servers with a team-dashboard allowlist of command and URL patterns.',
    verifiedAt: '2026-09-15',
    sources: [
      {
        url: 'https://cursor.com/docs/context/mcp',
        fact: 'Transports stdio/SSE/Streamable HTTP; config paths; mcpServers keys; interpolation vars; auth object (CLIENT_ID/CLIENT_SECRET/scopes) for providers without DCR; fixed redirect URLs; capability table Tools/Prompts/Resources/Roots/Elicitation/Apps supported; base64 images; Enterprise MCP allowlist',
      },
      {
        url: 'https://cursor.com/docs/context/mcp/install-links',
        fact: 'Deeplink format cursor://anysphere.cursor-deeplink/mcp/install?name=&config=<base64 JSON>',
      },
      {
        url: 'https://cursor.com/docs/enterprise/model-and-integration-management',
        fact: 'MCP Configuration allowlist is Enterprise only; server:tool patterns; command/URL matching; priority order dashboard > permissions.json > editor; allowlist does not distribute servers',
      },
      {
        url: 'https://forum.cursor.com/t/google-gws-cli-tool-names-too-long/153918/4',
        fact: "Cursor staff (deanrie, 2026-03-07): combined server name + tool name can't be more than 60 characters; flagged to team",
      },
      {
        url: 'https://cursor.com/blog/dynamic-context-discovery',
        fact: 'MCP tool descriptions synced to folder, loaded on demand; 46.9% token reduction (2026-01-06)',
      },
      {
        url: 'https://forum.cursor.com/t/tools-limited-to-40-total/67976',
        fact: 'Corroboration only (community): historical 40-tool limit',
      },
      {
        url: 'https://zuplo.com/learn/mcp/compatibility',
        fact: 'Corroboration only (secondary)',
      },
    ],
  },
  {
    id: 'vscode',
    name: 'VS Code (GitHub Copilot)',
    kind: 'ide',
    transports: {
      stdio: 'yes',
      streamableHttp: 'yes',
      sse: 'partial',
    },
    auth: {
      oauth: 'yes',
      dcr: 'yes',
      cimd: 'yes',
      preRegistered: 'yes',
      staticHeaders: 'yes',
      redirectUris: ['http://127.0.0.1:33418', 'https://vscode.dev/redirect'],
      note: null,
    },
    toolNaming: {
      format: 'mcp_{server}_{tool}',
      replacedChars: '[^A-Za-z0-9_-]',
      maxLength: 64,
      onOverflow: 'truncate',
    },
    toolLimits: {
      maxTools: 128,
      scope: 'per_request',
      toolSearch: 'yes',
    },
    schema: {
      rootCombinators: 'unknown',
      rejectedKeywords: [],
      typeArrays: 'unknown',
      onInvalid: 'drop_tool',
    },
    protocol: {
      revision: '2025-11-25',
      resources: 'yes',
      prompts: 'yes',
      sampling: 'yes',
      elicitation: 'yes',
    },
    config: {
      remote: {
        file: '.vscode/mcp.json',
        containerKey: 'servers',
        typeKey: 'type',
        typeValue: 'http',
        urlKey: 'url',
        headersKey: 'headers',
      },
      addCommand: 'code --add-mcp \'{"name":"{name}","type":"http","url":"{url}"}\'',
      deeplink: 'vscode:mcp/install?{config}',
    },
    availability: "Copilot Business/Enterprise orgs must enable the 'MCP servers in Copilot' policy, which is off by default.",
    verifiedAt: '2026-09-15',
    sources: [
      {
        url: 'https://code.visualstudio.com/docs/copilot/customization/mcp-servers',
        fact: 'servers key example, .vscode/mcp.json, ~/.copilot/mcp-config.json, code --add-mcp, resources/prompts/MCP Apps, GitHub policies',
      },
      {
        url: 'https://code.visualstudio.com/docs/agents/reference/mcp-configuration',
        fact: 'servers/inputs/sandbox; stdio fields incl cwd/env/envFile; http|sse with url/headers/oauth; oauth.clientId, oauth.enterpriseManaged; ${input:}, ${env:}, ${workspaceFolder}; input types; dev mode; chat.mcp.access/discovery/autostart/apps.enabled',
      },
      {
        url: 'https://code.visualstudio.com/api/extension-guides/ai/mcp',
        fact: 'Supported: tools, resources, prompts, elicitation, sampling, OAuth with DCR, roots, MCP Apps; annotations title/readOnlyHint; stdio/http/sse(legacy); redirect URLs 127.0.0.1:33418 and vscode.dev/redirect; vscode:mcp/install and vscode-insiders',
      },
      {
        url: 'https://code.visualstudio.com/docs/copilot/agents/agent-tools',
        fact: 'Max 128 tools per chat request; virtual tools via github.copilot.chat.virtualTools.threshold; tool sets',
      },
      {
        url: 'https://code.visualstudio.com/updates/v1_103',
        fact: 'Virtual tools grouping; 2025-06-18 spec incl. structured output and resource_link; client credentials (client ID/secret) flow when no DCR',
      },
      {
        url: 'https://code.visualstudio.com/updates/v1_107',
        fact: '2025-11-25 spec: URL elicitation, tasks, enum elicitation, WWW-Authenticate scope consent, CIMD flow, icons',
      },
      {
        url: 'https://github.com/microsoft/vscode/blob/main/src/vs/workbench/contrib/mcp/common/mcpServer.ts',
        fact: "Source code: toolInvalidCharRe /[^a-z0-9_-]/gi, invalid chars replaced with '_' + warning; draft-07 validation, invalid tools omitted; properties normalized; id = (prefix+name) dots->'_' sliced to MaxLength; prefix generator",
      },
      {
        url: 'https://github.com/microsoft/vscode/blob/main/src/vs/workbench/contrib/mcp/common/mcpTypes.ts',
        fact: "Source code: McpToolName Prefix='mcp_', MaxPrefixLen=18, MaxLength=64",
      },
      {
        url: 'https://github.com/microsoft/vscode/blob/main/src/vs/workbench/contrib/mcp/common/mcpServerRequestHandler.ts',
        fact: 'Source code: initialize capabilities: roots listChanged, sampling, elicitation form+url, tasks, io.modelcontextprotocol/ui extension; protocolVersion LATEST_PROTOCOL_VERSION',
      },
      {
        url: 'https://github.com/microsoft/vscode/blob/main/src/vs/platform/mcp/common/modelContextProtocol.ts',
        fact: 'Source code: LATEST_PROTOCOL_VERSION = "2025-11-25"',
      },
      {
        url: 'https://github.com/microsoft/vscode/issues/243602',
        fact: 'Maintainer (Connor Peet, 2025-03-14): CAPI/model limits tool names to 64; prefixing produced 400s; fixed in PR #243607',
      },
      {
        url: 'https://github.com/microsoft/vscode/issues/308463',
        fact: 'Warning text for dotted tool names (open, assigned sandy081, 2026-04-08)',
      },
      {
        url: 'https://github.com/microsoft/vscode/issues/257415',
        fact: 'Option to skip DCR / use static client info; closed via PR #317950, milestone 1.122.0',
      },
      {
        url: 'https://github.com/microsoft/vscode/issues/320145',
        fact: 'Tools without inputSchema sent to OpenAI-compatible endpoints omit parameters -> 400',
      },
      {
        url: 'https://docs.github.com/en/copilot/concepts/context/mcp',
        fact: 'MCP policy only applies to Copilot Business/Enterprise; disabled by default; IDEs VS Code, JetBrains, Visual Studio, Xcode, Eclipse',
      },
      {
        url: 'https://docs.github.com/en/copilot/how-tos/administer-copilot/manage-mcp-usage/configure-mcp-server-access',
        fact: 'Registry URL + access policy Allow all / Registry only; public preview; managed-settings.json recommended',
      },
    ],
  },
  {
    id: 'windsurf',
    name: 'Windsurf (Devin Desktop)',
    kind: 'ide',
    transports: {
      stdio: 'yes',
      streamableHttp: 'yes',
      sse: 'yes',
    },
    auth: {
      oauth: 'yes',
      dcr: 'unknown',
      cimd: 'unknown',
      preRegistered: 'unknown',
      staticHeaders: 'yes',
      redirectUris: [],
      note: null,
    },
    toolNaming: {
      format: null,
      replacedChars: null,
      maxLength: null,
      onOverflow: 'unknown',
    },
    toolLimits: {
      maxTools: 100,
      scope: 'total',
      toolSearch: 'unknown',
    },
    schema: {
      rootCombinators: 'unknown',
      rejectedKeywords: [],
      typeArrays: 'unknown',
      onInvalid: 'unknown',
    },
    protocol: {
      revision: null,
      resources: 'yes',
      prompts: 'yes',
      sampling: 'unknown',
      elicitation: 'unknown',
    },
    config: {
      remote: {
        file: '~/.codeium/windsurf/mcp_config.json',
        containerKey: 'mcpServers',
        typeKey: null,
        typeValue: null,
        urlKey: 'serverUrl',
        headersKey: 'headers',
      },
      addCommand: null,
      deeplink: null,
    },
    availability:
      'Enterprise users must turn MCP on in settings, and once a Teams/Enterprise admin allowlists any server all others are blocked.',
    verifiedAt: '2026-09-15',
    sources: [
      {
        url: 'https://docs.devin.ai/desktop/cascade/mcp',
        fact: 'Redirect target of docs.windsurf.com/windsurf/cascade/mcp. Transports stdio/Streamable HTTP/SSE; OAuth for each transport; ~/.codeium/windsurf/mcp_config.json; mcpServers, serverUrl/url, headers, env; ${env:} and ${file:} interpolation; 100 tool limit; tools/resources/prompts supported; admin allowlist regex; enterprise manual enable; deeplink windsurf://windsurf-mcp-registry; legacy Cascade note',
      },
    ],
  },
  {
    id: 'zed',
    name: 'Zed',
    kind: 'ide',
    transports: {
      stdio: 'yes',
      streamableHttp: 'yes',
      sse: 'no',
    },
    auth: {
      oauth: 'yes',
      dcr: 'yes',
      cimd: 'yes',
      preRegistered: 'unknown',
      staticHeaders: 'yes',
      redirectUris: [],
      note: 'OAuth starts only when no Authorization header is configured, and its loopback callback prefers port 27523 (exact redirect URI undocumented).',
    },
    toolNaming: {
      format: '{tool}',
      replacedChars: '[^A-Za-z0-9_-]',
      maxLength: 64,
      onOverflow: 'truncate',
    },
    toolLimits: {
      maxTools: null,
      scope: null,
      toolSearch: 'unknown',
    },
    schema: {
      rootCombinators: 'unknown',
      rejectedKeywords: [],
      typeArrays: 'unknown',
      onInvalid: 'sanitize',
    },
    protocol: {
      revision: '2025-11-25',
      resources: 'no',
      prompts: 'yes',
      sampling: 'no',
      elicitation: 'no',
    },
    config: {
      remote: {
        file: '~/.config/zed/settings.json or .zed/settings.json',
        containerKey: 'context_servers',
        typeKey: null,
        typeValue: null,
        urlKey: 'url',
        headersKey: 'headers',
      },
      addCommand: null,
      deeplink: null,
    },
    availability: null,
    verifiedAt: '2026-09-15',
    sources: [
      {
        url: 'https://zed.dev/docs/ai/mcp',
        fact: 'context_servers local (command/args/env) and remote (url/headers); OAuth prompt when no Authorization header; supports Tools and Prompts only; tools/list_changed; mcp:<server>:<tool_name> permission key; tool_permissions default',
      },
      {
        url: 'https://zed.dev/docs/extensions/mcp-extensions',
        fact: 'Extension context servers via extension.toml + context_server_command; remote servers added natively; extensions deprecated in favor of MCP registry',
      },
      {
        url: 'https://zed.dev/docs/configuring-zed',
        fact: 'Settings file paths',
      },
      {
        url: 'https://github.com/zed-industries/zed/pull/51768',
        fact: 'OAuth for remote Streamable HTTP servers: CIMD at zed.dev first, DCR fallback, Auth Code + PKCE, loopback port 27523, keychain; merged 2026-03-23',
      },
      {
        url: 'https://github.com/zed-industries/zed/blob/main/crates/context_server/src/oauth.rs',
        fact: 'Source code: CIMD_URL https://zed.dev/oauth/client-metadata.json; CIMD first, DCR fallback; PKCE S256',
      },
      {
        url: 'https://github.com/zed-industries/zed/blob/main/crates/context_server/src/transport/http.rs',
        fact: 'Source code: Streamable HTTP transport with SSE response streams, Mcp-Session-Id, MCP-Protocol-Version headers',
      },
      {
        url: 'https://github.com/zed-industries/zed/blob/main/crates/context_server/src/protocol.rs',
        fact: 'Source code: Supported protocol versions LATEST (2025-11-25), 2025-06-18, 2025-03-26, 2024-11-05; client capabilities sampling: None, roots: None',
      },
      {
        url: 'https://github.com/zed-industries/zed/blob/main/crates/context_server/src/types.rs',
        fact: 'Source code: LATEST_PROTOCOL_VERSION = 2025-11-25; ClientCapabilities has only experimental/sampling/roots (no elicitation)',
      },
      {
        url: 'https://github.com/zed-industries/zed/blob/main/crates/agent/src/thread.rs',
        fact: 'Source code: MAX_TOOL_NAME_LENGTH 64; provider_compatible_tool_name sanitizes to [A-Za-z0-9_-]; duplicate names prefixed with snake_case server id, else last one kept',
      },
      {
        url: 'https://github.com/zed-industries/zed/blob/main/crates/agent/src/tools/context_server_registry.rs',
        fact: 'Source code: Tool name = raw MCP name; empty/null schema -> object; normalize_tool_schema applied',
      },
      {
        url: 'https://github.com/zed-industries/zed/blob/main/crates/language_model_core/src/tool_schema.rs',
        fact: 'Source code: normalize_tool_schema removes root $schema/title/description, inlines #/$defs and #/definitions refs only',
      },
    ],
  },
  {
    id: 'jetbrains-ai',
    name: 'JetBrains AI Assistant',
    kind: 'ide',
    transports: {
      stdio: 'yes',
      streamableHttp: 'yes',
      sse: 'partial',
    },
    auth: {
      oauth: 'no',
      dcr: 'no',
      cimd: 'no',
      preRegistered: 'no',
      staticHeaders: 'partial',
      redirectUris: [],
      note: 'There is no OAuth flow, so servers that answer 401 fail to connect; JetBrains staff suggest bridging through `npx -y mcp-remote <url>` over stdio.',
    },
    toolNaming: {
      format: null,
      replacedChars: null,
      maxLength: null,
      onOverflow: 'unknown',
    },
    toolLimits: {
      maxTools: null,
      scope: null,
      toolSearch: 'unknown',
    },
    schema: {
      rootCombinators: 'unknown',
      rejectedKeywords: [],
      typeArrays: 'unknown',
      onInvalid: 'unknown',
    },
    protocol: {
      revision: null,
      resources: 'unknown',
      prompts: 'unknown',
      sampling: 'unknown',
      elicitation: 'unknown',
    },
    config: {
      remote: null,
      addCommand: null,
      deeplink: null,
    },
    availability:
      'Org admins can preconfigure servers and block custom ones; AI Free is unavailable in IntelliJ IDEA without Ultimate and PyCharm without Pro.',
    verifiedAt: '2026-09-15',
    sources: [
      {
        url: 'https://www.jetbrains.com/help/ai-assistant/mcp.html',
        fact: 'STDIO, Streamable HTTP, and legacy SSE transports; mcpServers JSON; Settings path; global/project level; import from Claude Desktop; admin preconfiguration/restriction; no mention of OAuth or headers',
      },
      {
        url: 'https://youtrack.jetbrains.com/issue/LLM-24541',
        fact: 'AI Assistant MCP gives 401 with no authentication link; state Open; staff (vladislav.kuzmeniuk) reproduced 2026-02-13 and suggested npx mcp-remote; description notes Junie MCP handles the same server correctly; user comment 2026-04-30 questions Authorization header support',
      },
      {
        url: 'https://youtrack.jetbrains.com/issue/LLM-25012',
        fact: "Feature request 'OAuth2 Authentication for MCP Server Connections' created 2026-02-23, State Open, updated 2026-09-14, Available in: empty",
      },
      {
        url: 'https://www.jetbrains.com/help/jetbrains-console/mcp-servers.html',
        fact: 'Org-level MCP servers apply only to AI Assistant (and Air), not Central CLI agents; command vs remote HTTP servers; remote supports HTTP headers; must be added to AI policy; preview/EAP',
      },
      {
        url: 'https://lp.jetbrains.com/ai-ides-faq/',
        fact: 'AI Free not available in Android Studio, IntelliJ IDEA without Ultimate, PyCharm without Pro',
      },
      {
        url: 'https://zuplo.com/learn/mcp/compatibility/clients/jetbrains-ai-assistant',
        fact: 'Corroboration only (secondary): no OAuth browser flow in AI Assistant docs 2025.2-2026.2',
      },
    ],
  },
  {
    id: 'junie',
    name: 'Junie',
    kind: 'ide',
    transports: {
      stdio: 'yes',
      streamableHttp: 'unknown',
      sse: 'unknown',
    },
    auth: {
      oauth: 'yes',
      dcr: 'unknown',
      cimd: 'unknown',
      preRegistered: 'unknown',
      staticHeaders: 'partial',
      redirectUris: [],
      note: 'The IDE plugin docs say security tokens in MCP configs are unsupported, while the Junie CLI docs document a headers key.',
    },
    toolNaming: {
      format: null,
      replacedChars: null,
      maxLength: null,
      onOverflow: 'unknown',
    },
    toolLimits: {
      maxTools: 100,
      scope: 'total',
      toolSearch: 'unknown',
    },
    schema: {
      rootCombinators: 'unknown',
      rejectedKeywords: [],
      typeArrays: 'unknown',
      onInvalid: 'unknown',
    },
    protocol: {
      revision: null,
      resources: 'unknown',
      prompts: 'unknown',
      sampling: 'unknown',
      elicitation: 'unknown',
    },
    config: {
      remote: {
        file: '~/.junie/mcp/mcp.json or .junie/mcp/mcp.json',
        containerKey: 'mcpServers',
        typeKey: null,
        typeValue: null,
        urlKey: 'url',
        headersKey: 'headers',
      },
      addCommand: null,
      deeplink: null,
    },
    availability: 'Requires a JetBrains AI license (a 30-day AI Pro trial is available).',
    verifiedAt: '2026-09-15',
    sources: [
      {
        url: 'https://junie.jetbrains.com/docs/junie-cli-mcp-configuration.html',
        fact: "Project .junie/mcp/mcp.json and user ~/.junie/mcp/mcp.json; mcpServers with command/args/env/url/headers; --mcp-location, --mcp-default-locations; /mcp command; 'Authorization required' status with browser OAuth via MCP Installation Assistant",
      },
      {
        url: 'https://junie.jetbrains.com/docs/junie-plugin-mcp-settings.html',
        fact: 'mcp.json with mcpServers; global or project level; IDE settings UI lists servers and their tools',
      },
      {
        url: 'https://junie.jetbrains.com/docs/junie-ide-plugin.html',
        fact: "'Junie supports a maximum of 100 tools from all configured MCP servers'; 'At the moment, Junie does not support security tokens in MCP configs.' (env-file workaround); license/trial; IDE version minimums",
      },
      {
        url: 'https://youtrack.jetbrains.com/issue/JUNIE-711',
        fact: "Server name with spaces produced provider error 'Invalid tools[12].name ... pattern ^[a-zA-Z0-9_-]+$'; created 2025-09-02; resolved as Duplicate of JUNIE-538",
      },
      {
        url: 'https://youtrack.jetbrains.com/issue/LLM-24541',
        fact: "Issue text: 'In the Junie MCP (Settings | Tools | Junie | MCP Settings) everything works as expected' for an HTTP server needing auth",
      },
      {
        url: 'https://www.jetbrains.com/help/jetbrains-console/mcp-servers.html',
        fact: 'Org-level MCP servers apply only to AI Assistant (and Air)',
      },
    ],
  },
  {
    id: 'cline',
    name: 'Cline',
    kind: 'ide',
    transports: {
      stdio: 'yes',
      streamableHttp: 'yes',
      sse: 'partial',
    },
    auth: {
      oauth: 'partial',
      dcr: 'yes',
      cimd: 'no',
      preRegistered: 'yes',
      staticHeaders: 'yes',
      redirectUris: [
        'http://127.0.0.1:1456/mcp/oauth/callback',
        'http://127.0.0.1:1457/mcp/oauth/callback',
        'http://127.0.0.1:1458/mcp/oauth/callback',
        'http://127.0.0.1:1459/mcp/oauth/callback',
        'http://127.0.0.1:1460/mcp/oauth/callback',
        'http://127.0.0.1:1461/mcp/oauth/callback',
      ],
      note: "Re-authorization after token expiry can fail with 'Invalid OAuth state' (open issue #7964).",
    },
    toolNaming: {
      format: '{server}__{tool}',
      replacedChars: '[^A-Za-z0-9_-]',
      maxLength: 64,
      onOverflow: 'truncate_hash',
    },
    toolLimits: {
      maxTools: null,
      scope: null,
      toolSearch: 'unknown',
    },
    schema: {
      rootCombinators: 'unknown',
      rejectedKeywords: [],
      typeArrays: 'unknown',
      onInvalid: 'unknown',
    },
    protocol: {
      revision: null,
      resources: 'yes',
      prompts: 'yes',
      sampling: 'no',
      elicitation: 'no',
    },
    config: {
      remote: {
        file: '~/.cline/data/settings/cline_mcp_settings.json',
        containerKey: 'mcpServers',
        typeKey: 'type',
        typeValue: 'streamableHttp',
        urlKey: 'url',
        headersKey: 'headers',
      },
      addCommand: null,
      deeplink: null,
    },
    availability: 'Enterprise remote config can restrict servers to an allowlist and block personal remote servers.',
    verifiedAt: '2026-09-15',
    sources: [
      {
        url: 'https://docs.cline.bot/mcp/mcp-overview',
        fact: 'STDIO, streamableHttp (recommended), sse (legacy); CLI ~/.cline/mcp.json; `cline mcp` management; mcpServers/type/url/headers/disabled/autoApprove keys',
      },
      {
        url: 'https://docs.cline.bot/mcp/connecting-to-a-remote-server',
        fact: 'Remote headers {"Authorization": "Bearer your-token"}; untyped url defaults to legacy sse for backward compatibility',
      },
      {
        url: 'https://github.com/cline/cline/blob/82b8e1fa0471f728e3d9540fd19aa063e2049497/apps/vscode/src/services/mcp/schemas.ts',
        fact: "Source code: zod schema: type literals stdio/sse/streamableHttp; sse arm precedes streamableHttp, so an untyped url defaults to sse; legacy transportType 'http' maps to streamableHttp; headers, autoApprove, disabled, timeout; nested CLI transport form",
      },
      {
        url: 'https://github.com/cline/cline/blob/82b8e1fa0471f728e3d9540fd19aa063e2049497/sdk/packages/core/src/extensions/mcp/name-transform.ts',
        fact: "Source code: serverName__toolName; invalid chars [^a-zA-Z0-9_-]+ replaced with '_'; MAX 64; overflow/sanitized names become 55-char base + '_' + 8-hex sha1",
      },
      {
        url: 'https://github.com/cline/cline/blob/82b8e1fa0471f728e3d9540fd19aa063e2049497/sdk/packages/core/src/extensions/mcp/tools.ts',
        fact: 'Source code: createMcpTools passes descriptor.inputSchema unchanged',
      },
      {
        url: 'https://github.com/cline/cline/blob/82b8e1fa0471f728e3d9540fd19aa063e2049497/apps/vscode/src/sdk/message-translator.ts',
        fact: "Source code: parseMcpToolName splits on the first '__'",
      },
      {
        url: 'https://github.com/cline/cline/blob/82b8e1fa0471f728e3d9540fd19aa063e2049497/apps/vscode/src/services/mcp/McpHub.ts',
        fact: 'Source code: Client capabilities {}; Stdio/SSE/StreamableHTTP transports; resources/list, resources/templates/list, prompts/list; ${env:VAR_NAME} expansion in URLs, headers, env',
      },
      {
        url: 'https://github.com/cline/cline/blob/82b8e1fa0471f728e3d9540fd19aa063e2049497/apps/vscode/src/services/mcp/McpOAuthManager.ts',
        fact: "Source code: OAuth state in ~/.cline/data/settings/cline_mcp_settings.json; redirect http://127.0.0.1:1456/mcp/oauth/callback; ports 1456-1461; client_name 'Cline'; code verifier storage",
      },
      {
        url: 'https://github.com/cline/cline/blob/82b8e1fa0471f728e3d9540fd19aa063e2049497/sdk/packages/core/src/extensions/mcp/oauth.ts',
        fact: 'Source code: createMcpOAuthClientInformation maps oauthClient.clientId/clientSecret to pre-registered client; saveClientInformation (DCR persistence); token_endpoint_auth_method none; no clientMetadataUrl',
      },
      {
        url: 'https://github.com/cline/cline/blob/82b8e1fa0471f728e3d9540fd19aa063e2049497/sdk/packages/core/src/extensions/mcp/config-loader.ts',
        fact: 'Source code: oauthClientSchema {clientId, clientSecret?} under per-server oauthClient; transport schemas stdio/sse/streamableHttp',
      },
      {
        url: 'https://github.com/cline/cline/blob/82b8e1fa0471f728e3d9540fd19aa063e2049497/apps/vscode/webview-ui/src/components/mcp/configuration/tabs/installed/server-row/ServerRow.tsx',
        fact: "Source code: 'Authenticate' button shown when oauthRequired and unauthenticated",
      },
      {
        url: 'https://github.com/cline/cline/blob/82b8e1fa0471f728e3d9540fd19aa063e2049497/sdk/packages/shared/src/mcp.ts',
        fact: 'Source code: DEFAULT_MCP_TIMEOUT_SECONDS=60, MIN=1, MAX=3600',
      },
      {
        url: 'https://github.com/cline/cline/issues/7964',
        fact: "Remote MCP re-auth fails ('Invalid OAuth state - possible CSRF attack'); opened 2025-12-07; open",
      },
      {
        url: 'https://docs.cline.bot/enterprise-solutions/configuration/infrastructure-configuration/control-other-cline-features/mcp-server-controls',
        fact: 'mcpMarketplaceEnabled, allowedMCPServers, remoteMCPServers (alwaysEnabled), blockPersonalRemoteMCPServers; header example Bearer ${AUTH_TOKEN}',
      },
    ],
  },
  {
    id: 'continue',
    name: 'Continue',
    kind: 'ide',
    transports: {
      stdio: 'yes',
      streamableHttp: 'yes',
      sse: 'yes',
    },
    auth: {
      oauth: 'yes',
      dcr: 'yes',
      cimd: 'no',
      preRegistered: 'unknown',
      staticHeaders: 'yes',
      redirectUris: ['http://localhost:3000'],
      note: 'In remote VS Code environments the redirect is the getExternalUri equivalent of http://localhost:3000.',
    },
    toolNaming: {
      format: '{server}_{tool}',
      replacedChars: null,
      maxLength: null,
      onOverflow: 'unknown',
    },
    toolLimits: {
      maxTools: null,
      scope: null,
      toolSearch: 'unknown',
    },
    schema: {
      rootCombinators: 'unknown',
      rejectedKeywords: ['$ref'],
      typeArrays: 'partial',
      onInvalid: 'unknown',
    },
    protocol: {
      revision: null,
      resources: 'yes',
      prompts: 'yes',
      sampling: 'no',
      elicitation: 'no',
    },
    config: {
      remote: {
        file: '.continue/mcpServers/*.json',
        containerKey: 'mcpServers',
        typeKey: 'type',
        typeValue: 'http',
        urlKey: 'url',
        headersKey: 'headers',
      },
      addCommand: null,
      deeplink: null,
    },
    availability: 'MCP works only in agent mode, not chat or autocomplete.',
    verifiedAt: '2026-09-15',
    sources: [
      {
        url: 'https://docs.continue.dev/customize/deep-dives/mcp',
        fact: "mcpServers in config.yaml; .continue/mcpServers/; stdio/sse/streamable-http; ${{ secrets.X }}; 'MCP can only be used in the agent mode'; copy Claude Desktop/Cursor/Cline JSON",
      },
      {
        url: 'https://docs.continue.dev/customize/deep-dives/mcp-examples',
        fact: 'YAML examples with type sse, streamable-http; apiKey: ${{ secrets.LINEAR_OAUTH_TOKEN }}',
      },
      {
        url: 'https://docs.continue.dev/reference',
        fact: 'mcpServers properties name, command, args, env, cwd, requestOptions (sse/streamable-http), connectionTimeout',
      },
      {
        url: 'https://github.com/continuedev/continue/blob/5522c6f44ca0ac3528b37244818fbfa39b5af470/packages/config-yaml/src/schemas/mcp/index.ts',
        fact: 'Source code: zod: stdio {command,args,env,cwd}; sse|streamable-http {url, apiKey, requestOptions}; connectionTimeout',
      },
      {
        url: 'https://github.com/continuedev/continue/blob/5522c6f44ca0ac3528b37244818fbfa39b5af470/packages/config-yaml/src/schemas/mcp/convertJson.ts',
        fact: "Source code: JSON type 'http' → 'streamable-http', any other type → 'sse'; JSON headers map to requestOptions.headers",
      },
      {
        url: 'https://github.com/continuedev/continue/blob/5522c6f44ca0ac3528b37244818fbfa39b5af470/core/tools/mcpToolName.ts',
        fact: "Source code: Tool name = sanitized lowercase server prefix + '_' + tool name, unless tool already starts with the prefix; no length cap",
      },
      {
        url: 'https://github.com/continuedev/continue/blob/5522c6f44ca0ac3528b37244818fbfa39b5af470/core/context/mcp/MCPConnection.ts',
        fact: 'Source code: Stdio/SSE/StreamableHTTP/WebSocket transports; capabilities {}; DEFAULT_MCP_TIMEOUT 20s; apiKey merged as Bearer header; listResources/listResourceTemplates/listPrompts',
      },
      {
        url: 'https://github.com/continuedev/continue/blob/5522c6f44ca0ac3528b37244818fbfa39b5af470/core/context/mcp/MCPOauth.ts',
        fact: "Source code: OAuth via SDK auth(); redirect http://localhost:3000 or getExternalUri; client metadata token_endpoint_auth_method none, client_name 'Continue Dev, Inc'; clientInformation/saveClientInformation (DCR persistence); no clientMetadataUrl",
      },
      {
        url: 'https://github.com/continuedev/continue/blob/5522c6f44ca0ac3528b37244818fbfa39b5af470/core/llm/llms/gemini-types.ts',
        fact: 'Source code: convertJsonSchemaToGeminiSchema throws when a node lacks a string type; copies only whitelisted keys; format unsupported (TODO)',
      },
      {
        url: 'https://github.com/continuedev/continue/blob/5522c6f44ca0ac3528b37244818fbfa39b5af470/core/context/providers/MCPContextProvider.ts',
        fact: "Source code: MCP resources exposed as the 'MCP Resources' context provider",
      },
      {
        url: 'https://github.com/continuedev/continue/blob/5522c6f44ca0ac3528b37244818fbfa39b5af470/core/commands/slash/mcpSlashCommand.ts',
        fact: "Source code: MCP prompts exposed as slash commands (source 'mcp-prompt')",
      },
    ],
  },
  {
    id: 'goose',
    name: 'Goose',
    kind: 'cli',
    transports: {
      stdio: 'yes',
      streamableHttp: 'yes',
      sse: 'no',
    },
    auth: {
      oauth: 'yes',
      dcr: 'yes',
      cimd: 'yes',
      preRegistered: 'yes',
      staticHeaders: 'yes',
      redirectUris: [],
      note: null,
    },
    toolNaming: {
      format: '{server}__{tool}',
      replacedChars: null,
      maxLength: null,
      onOverflow: 'unknown',
    },
    toolLimits: {
      maxTools: null,
      scope: null,
      toolSearch: 'unknown',
    },
    schema: {
      rootCombinators: 'unknown',
      rejectedKeywords: [],
      typeArrays: 'unknown',
      onInvalid: 'unknown',
    },
    protocol: {
      revision: '2026-07-28',
      resources: 'yes',
      prompts: 'yes',
      sampling: 'yes',
      elicitation: 'yes',
    },
    config: {
      remote: {
        file: '~/.config/goose/config.yaml',
        containerKey: 'extensions',
        typeKey: 'type',
        typeValue: 'streamable_http',
        urlKey: 'uri',
        headersKey: 'headers',
      },
      addCommand: null,
      deeplink: 'goose://extension?url={url}&type=streamable_http&id={name}&name={name}',
    },
    availability: 'GOOSE_ALLOWLIST can restrict extensions to an org-hosted allowlist.',
    verifiedAt: '2026-09-15',
    sources: [
      {
        url: 'https://goose-docs.ai/docs/getting-started/using-extensions/',
        fact: 'config path; stdio/streamable_http YAML keys; client_id/client_secret_key/scopes; CIMD+DCR; GOOSE_OAUTH_CALLBACK_PORT; CLI flags; goose configure; deeplink formats (URL-encoded)',
      },
      {
        url: 'https://goose-docs.ai/docs/guides/config-files/',
        fact: "Types builtin/platform/stdio/streamable_http; 'SSE is not supported; migrate old SSE configurations to streamable_http'; headers, env_keys, envs, available_tools; GOOSE_ALLOWLIST; keyring/secrets.yaml; precedence; Windows path",
      },
      {
        url: 'https://goose-docs.ai/docs/guides/managing-tools/tool-permissions/',
        fact: "'goose performs best with fewer than 25 total tools enabled across all extensions'",
      },
      {
        url: 'https://github.com/block/goose/blob/abb47465996cd1041c4dbb83decf3f27216d3007/crates/goose/src/agents/extension_manager.rs',
        fact: 'Source code: public tool name format!("{}__{}", name, tool.name) unless unprefixed_tools; ProtocolVersion::V_2025_11_25 legacy capabilities',
      },
      {
        url: 'https://github.com/block/goose/blob/abb47465996cd1041c4dbb83decf3f27216d3007/crates/goose/src/agents/mcp_client.rs',
        fact: 'Source code: ClientCapabilities enable_roots/enable_sampling/enable_elicitation; lifecycle Auto preferred [V_2026_07_28, V_2025_11_25], Discover for >= STANDARD_HEADERS; working_directory root',
      },
      {
        url: 'https://github.com/block/goose/blob/abb47465996cd1041c4dbb83decf3f27216d3007/crates/goose/src/oauth/mod.rs',
        fact: 'Source code: CLIENT_METADATA_URL https://goose-docs.ai/oauth/client-metadata.json; GOOSE_MCP_OAUTH_CLIENT_METADATA_URL; preregistered client for servers with neither DCR nor CIMD; callback timeout default 300s (GOOSE_OAUTH_CALLBACK_TIMEOUT_SECONDS)',
      },
      {
        url: 'https://github.com/block/goose/blob/abb47465996cd1041c4dbb83decf3f27216d3007/crates/goose/src/config/extensions.rs',
        fact: 'Source code: Warning "SSE is unsupported, migrate to streamable_http" for type: sse',
      },
      {
        url: 'https://github.com/block/goose/blob/abb47465996cd1041c4dbb83decf3f27216d3007/crates/goose-cli/src/cli.rs',
        fact: "Source code: --with-extension, --with-streamable-http-extension 'url [timeout=N]', --with-builtin",
      },
      {
        url: 'https://github.com/block/goose/blob/abb47465996cd1041c4dbb83decf3f27216d3007/Cargo.toml',
        fact: 'Source code: rmcp 3.2.0 with auth feature',
      },
      {
        url: 'https://block.github.io/goose/docs/guides/tool-router/',
        fact: 'Tool Router (preview) page now returns 404; status unknown',
      },
    ],
  },
  {
    id: 'lovable',
    name: 'Lovable',
    kind: 'app_builder',
    transports: {
      stdio: 'partial',
      streamableHttp: 'yes',
      sse: 'unknown',
    },
    auth: {
      oauth: 'yes',
      dcr: 'unknown',
      cimd: 'unknown',
      preRegistered: 'unknown',
      staticHeaders: 'partial',
      redirectUris: [],
      note: 'Only a bearer token or API key can be sent (no arbitrary header names), and connections come from non-fixed IPs unless Enterprise static IPs are enabled.',
    },
    toolNaming: {
      format: null,
      replacedChars: null,
      maxLength: null,
      onOverflow: 'unknown',
    },
    toolLimits: {
      maxTools: null,
      scope: null,
      toolSearch: 'unknown',
    },
    schema: {
      rootCombinators: 'unknown',
      rejectedKeywords: [],
      typeArrays: 'unknown',
      onInvalid: 'unknown',
    },
    protocol: {
      revision: null,
      resources: 'unknown',
      prompts: 'unknown',
      sampling: 'unknown',
      elicitation: 'unknown',
    },
    config: {
      remote: null,
      addCommand: null,
      deeplink: null,
    },
    availability:
      'All plans including Free; Business/Enterprise admins can disable custom MCP or limit who creates connections, and local servers need the desktop app.',
    verifiedAt: '2026-09-15',
    sources: [
      {
        url: 'https://docs.lovable.dev/integrations/custom-mcp',
        fact: 'Custom MCP: remote server by URL; auth OAuth (default) / Bearer token or API key / No authentication; all plans; static IPs Enterprise-only with ranges; connection type fixed at creation; never part of published app',
      },
      {
        url: 'https://docs.lovable.dev/integrations/mcp-servers',
        fact: 'Chat connectors enabled by default on all plans; Business/Enterprise admins can turn off; chat-only, not in published app; prebuilt connector list',
      },
      {
        url: 'https://docs.lovable.dev/integrations/desktop-app',
        fact: 'Desktop app supports remote and local MCP servers; custom local server via command and arguments or local HTTP URL; local servers desktop-only; all plans incl. Free',
      },
      {
        url: 'https://docs.lovable.dev/features/privacy-and-security-settings',
        fact: "Workspace toggles 'Remote MCP connectors' and 'Local desktop MCP servers' (latter requires former)",
      },
      {
        url: 'https://docs.lovable.dev/integrations/admin-controls',
        fact: "Admin settings and 'who can create connections' on Business/Enterprise; Free/Pro editors+ can create; Custom MCP row governs all custom servers",
      },
      {
        url: 'https://docs.lovable.dev/integrations/mcp-registries',
        fact: 'MCP registries on all plans, follow MCP registry spec, registry auth is bearer token only; servers from registry use direct connection; local servers need desktop app',
      },
      {
        url: 'https://docs.lovable.dev/integrations/security',
        fact: 'Custom MCP servers do not route through connector gateway; gateway 1,000 req/min per connector per project',
      },
      {
        url: 'https://docs.lovable.dev/changelog',
        fact: "Changelog: 'Custom MCP servers are now available on all plans, no paid plan required'; desktop app with local MCP support",
      },
    ],
  },
  {
    id: 'replit',
    name: 'Replit Agent',
    kind: 'app_builder',
    transports: {
      stdio: 'no',
      streamableHttp: 'yes',
      sse: 'unknown',
    },
    auth: {
      oauth: 'yes',
      dcr: 'yes',
      cimd: 'unknown',
      preRegistered: 'unknown',
      staticHeaders: 'yes',
      redirectUris: [],
      note: "All MCP traffic passes through Replit's security scanner, which can block individual tools.",
    },
    toolNaming: {
      format: null,
      replacedChars: null,
      maxLength: null,
      onOverflow: 'unknown',
    },
    toolLimits: {
      maxTools: null,
      scope: null,
      toolSearch: 'unknown',
    },
    schema: {
      rootCombinators: 'unknown',
      rejectedKeywords: [],
      typeArrays: 'unknown',
      onInvalid: 'unknown',
    },
    protocol: {
      revision: null,
      resources: 'unknown',
      prompts: 'unknown',
      sampling: 'unknown',
      elicitation: 'unknown',
    },
    config: {
      remote: null,
      addCommand: null,
      deeplink: 'https://replit.com/integrations?mcp={config}',
    },
    availability: null,
    verifiedAt: '2026-09-15',
    sources: [
      {
        url: 'https://docs.replit.com/build/connect-via-mcp',
        fact: 'Add custom MCP: HTTPS endpoint, Advanced settings custom headers, Test & save walks through OAuth; tools available across all projects; confirmation prompt if tool requires',
      },
      {
        url: 'https://docs.replit.com/features/mcp/overview',
        fact: 'Auth: OAuth DCR auto-detect/register; custom headers on every request; security scanner blocks unsafe tools; install link format base64 JSON displayName/baseUrl/headers; pre-listed links include /sse endpoints',
      },
      {
        url: 'https://docs.replit.com/features/mcp/install-links',
        fact: 'Install link https://replit.com/integrations?mcp=[base64-encoded-json]; baseUrl must be HTTPS; headers array of {key,value}',
      },
      {
        url: 'https://docs.replit.com/updates/2025/12/12/changelog',
        fact: 'Agent now supports custom (remote) MCP servers; automatically loads tools',
      },
      {
        url: 'https://docs.replit.com/home/integrations',
        fact: 'Connector catalog shows what is available on your plan (no MCP-specific plan statement)',
      },
    ],
  },
  {
    id: 'bolt',
    name: 'Bolt.new',
    kind: 'app_builder',
    transports: {
      stdio: 'no',
      streamableHttp: 'yes',
      sse: 'yes',
    },
    auth: {
      oauth: 'yes',
      dcr: 'unknown',
      cimd: 'unknown',
      preRegistered: 'unknown',
      staticHeaders: 'partial',
      redirectUris: [],
      note: "The API key option's header name and format are undocumented, and arbitrary custom headers are not offered.",
    },
    toolNaming: {
      format: null,
      replacedChars: null,
      maxLength: null,
      onOverflow: 'unknown',
    },
    toolLimits: {
      maxTools: null,
      scope: null,
      toolSearch: 'unknown',
    },
    schema: {
      rootCombinators: 'unknown',
      rejectedKeywords: [],
      typeArrays: 'unknown',
      onInvalid: 'unknown',
    },
    protocol: {
      revision: null,
      resources: 'unknown',
      prompts: 'unknown',
      sampling: 'unknown',
      elicitation: 'unknown',
    },
    config: {
      remote: null,
      addCommand: null,
      deeplink: null,
    },
    availability: null,
    verifiedAt: '2026-09-15',
    sources: [
      {
        url: 'https://support.bolt.new/building/using-bolt/connect-mcp',
        fact: 'Custom MCP fields Name/URL/Transport type (HTTP or SSE)/Authentication (API key, MCP OAuth, None); tools on by default, account-wide tool toggles; per-project connector toggles; auto tool discovery; context/token warning',
      },
      {
        url: 'https://bolt.new/blog/introducing-connectors',
        fact: '2026-03-11: eight built-in connectors; custom connector requires remote MCP server; transport usually HTTP or SSE; API key or sign-in',
      },
      {
        url: 'https://support.bolt.new/settings/account-settings',
        fact: 'Connectors (MCP) live in account settings',
      },
      {
        url: 'https://support.bolt.new/account-and-subscription/team-plans',
        fact: 'No connector/MCP plan gating mentioned (negative check)',
      },
    ],
  },
  {
    id: 'v0',
    name: 'v0',
    kind: 'app_builder',
    transports: {
      stdio: 'no',
      streamableHttp: 'yes',
      sse: 'unknown',
    },
    auth: {
      oauth: 'yes',
      dcr: 'partial',
      cimd: 'partial',
      preRegistered: 'partial',
      staticHeaders: 'yes',
      redirectUris: ['https://api.v0.dev/v1/mcp-servers/oauth/callback'],
      note: 'CIMD and pre-registered clients are documented only for the v0 API, whose OAuth config requires authorizationUrl, tokenUrl and clientId; the v0.app UI callback URL is undocumented.',
    },
    toolNaming: {
      format: null,
      replacedChars: null,
      maxLength: null,
      onOverflow: 'unknown',
    },
    toolLimits: {
      maxTools: null,
      scope: null,
      toolSearch: 'unknown',
    },
    schema: {
      rootCombinators: 'unknown',
      rejectedKeywords: [],
      typeArrays: 'unknown',
      onInvalid: 'unknown',
    },
    protocol: {
      revision: null,
      resources: 'no',
      prompts: 'no',
      sampling: 'unknown',
      elicitation: 'unknown',
    },
    config: {
      remote: null,
      addCommand: null,
      deeplink: null,
    },
    availability: null,
    verifiedAt: '2026-09-15',
    sources: [
      {
        url: 'https://v0.app/docs/MCP',
        fact: 'BYO MCP via + menu -> MCPs; auth No Auth/Custom Headers/Bearer Token/OAuth 2.0; MCP servers only provide tools; generated app cannot use MCP tools; availability vs approval modes; presets',
      },
      {
        url: 'https://v0.app/docs/api/platform/reference/mcp-servers/create',
        fact: 'Create MCP server schema: auth types, token max 1000, max 10 headers, oauth config fields incl. registrationUrl, usePKCE default true, clientIdMetadataDocumentSupported, scope user|team, HTTPS url max 500',
      },
      {
        url: 'https://v0.app/docs/api/v1/guides/oauth-mcp-servers',
        fact: 'Redirect URI https://api.v0.dev/v1/mcp-servers/oauth/callback; CIMD client ID URL https://v0.app/api/chat/integrations/oauth/client-metadata.json; DCR/manual registration done via provider flow; resource sent as RFC 8707 indicator; POST /v1/mcp-servers/{id}/oauth/authorize',
      },
      {
        url: 'https://vercel.com/changelog/v0-api-now-supports-custom-mcp-servers',
        fact: '2026-03-06: v0 API supports any custom MCP server; reference by server ID in chat creation',
      },
      {
        url: 'https://v0.app/pricing',
        fact: 'Plans Free/Plus/Business/Enterprise; no MCP mention (negative check)',
      },
    ],
  },
];
