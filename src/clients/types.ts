/**
 * What each MCP client can and cannot do, as data a rules engine evaluates.
 *
 * Every field is a claim about someone else's product, so every profile carries
 * its sources and the date they were read, and anything no primary source
 * confirmed is `unknown` — never a guess. The evaluator treats `unknown` as
 * "cannot promise", which is the only honest reading when a user is about to
 * rely on the answer.
 */

export type Support = 'yes' | 'partial' | 'no' | 'unknown';

export type ClientId =
  | 'claude-code'
  | 'claude-desktop'
  | 'claude-ai'
  | 'claude-api'
  | 'chatgpt'
  | 'openai-responses'
  | 'codex'
  | 'gemini-cli'
  | 'cursor'
  | 'vscode'
  | 'windsurf'
  | 'zed'
  | 'jetbrains-ai'
  | 'junie'
  | 'cline'
  | 'continue'
  | 'goose'
  | 'lovable'
  | 'replit'
  | 'bolt'
  | 'v0';

/** Every client id, for input validation that must not load the profiles themselves. */
export const CLIENT_IDS = [
  'claude-code',
  'claude-desktop',
  'claude-ai',
  'claude-api',
  'chatgpt',
  'openai-responses',
  'codex',
  'gemini-cli',
  'cursor',
  'vscode',
  'windsurf',
  'zed',
  'jetbrains-ai',
  'junie',
  'cline',
  'continue',
  'goose',
  'lovable',
  'replit',
  'bolt',
  'v0',
] as const satisfies readonly ClientId[];

export type ClientKind = 'cli' | 'ide' | 'desktop' | 'web' | 'api' | 'app_builder';

export interface ToolNameRule {
  /** How the model sees a tool name, with `{server}` and `{tool}` placeholders. Null when unknown. */
  format: string | null;
  /** Regex source for characters the client replaces with `_` before the model sees them. Null when none or unknown. */
  replacedChars: string | null;
  /** Longest name the model can receive, after prefixing. Null when unknown. */
  maxLength: number | null;
  /** What happens past `maxLength`. */
  onOverflow: 'truncate' | 'truncate_hash' | 'error' | 'drop_tool' | 'unknown';
}

export interface SchemaRules {
  /** A root-level anyOf/oneOf/allOf in `inputSchema`. */
  rootCombinators: Support;
  /** Keywords a primary source says the client (or the model API behind it) rejects without sanitizing. */
  rejectedKeywords: string[];
  /** `"type": ["string", "null"]`. */
  typeArrays: Support;
  /** What the client does with a schema it cannot use. */
  onInvalid: 'fail_request' | 'drop_tool' | 'sanitize' | 'unknown';
}

export interface ToolLimits {
  /** Documented cap on tools. Null when none is documented. */
  maxTools: number | null;
  scope: 'per_request' | 'total' | 'per_server' | null;
  /** Deferred loading / tool search that makes large tool lists cheap. */
  toolSearch: Support;
}

export interface AuthSupport {
  /** Runs the MCP OAuth 2.1 flow. */
  oauth: Support;
  /** Dynamic Client Registration (RFC 7591). */
  dcr: Support;
  /** Client ID Metadata Documents. */
  cimd: Support;
  /** Lets the user enter a pre-registered client id (and secret). */
  preRegistered: Support;
  /** Static custom headers (e.g. `Authorization: Bearer …`) on a remote server. */
  staticHeaders: Support;
  /** Redirect URIs a server's authorization server must allow for this client. */
  redirectUris: string[];
  /** One sentence on a caveat that changes an outcome (plan gating, admin-only headers). */
  note: string | null;
  /**
   * Spec checks a primary source says this client enforces. Absent means not
   * confirmed either way, and the evaluator reports the deviation as a warning
   * rather than a block.
   */
  strict?: {
    /** Refuses an authorization server that does not advertise PKCE S256. */
    pkceS256Required?: boolean;
    /** Rejects an authorization response whose `iss` does not match (RFC 9207). */
    issValidated?: boolean;
  };
}

export interface ProtocolSupport {
  /** Newest spec revision a primary source confirms. */
  revision: string | null;
  resources: Support;
  prompts: Support;
  sampling: Support;
  elicitation: Support;
}

/** How to write a remote server into this client's config. Null when the client is configured only through UI. */
export interface RemoteConfigTemplate {
  /** Config file path(s) as documented, `~` for home. */
  file: string;
  /** The object key servers live under: `mcpServers`, `servers`, `context_servers`, … */
  containerKey: string;
  /** Key and value that mark a streamable HTTP entry, when the client needs one. */
  typeKey: string | null;
  typeValue: string | null;
  /** Key holding the URL: `url`, `serverUrl`, `httpUrl`, … */
  urlKey: string;
  /** Key holding headers, when static headers are supported. */
  headersKey: string | null;
}

export interface ClientProfile {
  id: ClientId;
  name: string;
  kind: ClientKind;
  transports: { stdio: Support; streamableHttp: Support; sse: Support };
  auth: AuthSupport;
  toolNaming: ToolNameRule;
  toolLimits: ToolLimits;
  schema: SchemaRules;
  protocol: ProtocolSupport;
  config: {
    remote: RemoteConfigTemplate | null;
    /** CLI command with `{name}`, `{url}` and `{header}` placeholders, when one exists. */
    addCommand: string | null;
    /** Install deeplink template with `{name}` and `{config}` placeholders, when one exists. */
    deeplink: string | null;
  };
  /** Plan or admin gating that can block a server regardless of compatibility. */
  availability: string | null;
  /** ISO date the sources were read. */
  verifiedAt: string;
  sources: { url: string; fact: string }[];
}
