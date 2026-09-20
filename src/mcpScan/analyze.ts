/**
 * What a server's tools DO, and whether anything in what it tells the model is
 * trying to steer it.
 *
 * Two analyses over the same snapshot, both deliberately conservative:
 *
 *   CAPABILITIES. Labels like `shell.exec` or `messaging.send`, read from tool
 *   names, parameter names and description phrasing. Annotations are the
 *   server's own claim about itself; these labels are an independent reading
 *   of the same tool, which is what makes "declares read-only, is named
 *   delete_file" detectable at all. They are heuristic and say so — evidence is
 *   attached to every label so a reader can overrule it in one glance.
 *
 *   FINDINGS. For MCP a description is not documentation, it is text placed
 *   directly in the model's context by a third party. The published attacks
 *   (tool poisoning, shadowing, rug pulls, ASCII smuggling) all live there. The
 *   patterns below target those phrasings specifically and are tuned against
 *   real servers' descriptions: a false "this server is attacking you" costs
 *   more trust than a missed low-grade one.
 *
 * And a third, over two snapshots: `diffSnapshots`, where a description that
 * changed after approval and now carries a finding is reported as the attack it
 * is rather than as "prose polished".
 */
import { SEVERITY_RANK, type Severity } from '../audit/types';
import { analyzeStack, type McpStackReport } from '../compat/mcpStack';
import {
  diffMcpSurfaces,
  mcpSurface,
  resolveAnnotations,
  summarizeDrift,
  type McpDrift,
  type McpTool,
} from '../surface/mcp';
import type { PromptInfo, Snapshot } from './snapshot';

// ── Capabilities ──────────────────────────────────────────────────────────────

export type Capability =
  | 'shell.exec'
  | 'code.exec'
  | 'filesystem.write'
  | 'filesystem.read'
  | 'network.fetch'
  | 'browser.control'
  | 'messaging.send'
  | 'payments'
  | 'database.write'
  | 'database.read'
  | 'vcs.write'
  | 'credentials';

/** Capabilities that change something outside the conversation. */
export const WRITE_CAPABILITIES: ReadonlySet<Capability> = new Set<Capability>([
  'shell.exec',
  'code.exec',
  'filesystem.write',
  'messaging.send',
  'payments',
  'database.write',
  'vcs.write',
]);

export interface CapabilityHit {
  capability: Capability;
  /** Why: the name token, parameter or phrase that matched. */
  evidence: string;
}

/** `executeSQLQuery`, `delete-file`, `browser_navigate` → lowercase word set. */
export function words(name: string): Set<string> {
  return new Set(
    name
      .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
      .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter(Boolean),
  );
}

const has = (w: Set<string>, ...xs: string[]) => xs.find((x) => w.has(x));

interface Rule {
  capability: Capability;
  /** Returns the matched token(s) for evidence, or undefined. */
  name?: (w: Set<string>) => string | undefined;
  param?: RegExp;
  text?: RegExp;
}

const both = (a: string | undefined, b: string | undefined) => (a && b ? `${a} ${b}` : undefined);

const RULES: Rule[] = [
  {
    capability: 'shell.exec',
    name: (w) =>
      has(w, 'shell', 'bash', 'terminal', 'powershell', 'zsh') ??
      both(has(w, 'run', 'execute', 'exec'), has(w, 'command', 'commands', 'script', 'process')),
    text: /\b(?:execut|run)\w*\s+(?:an?\s+|any\s+)?(?:arbitrary\s+)?(?:shell|terminal|bash|system)\s+commands?\b/i,
  },
  {
    capability: 'code.exec',
    name: (w) =>
      has(w, 'eval', 'repl') ??
      both(
        has(w, 'run', 'execute', 'exec'),
        has(w, 'code', 'python', 'javascript', 'js', 'notebook', 'cell'),
      ),
    text: /\b(?:execut|run|evaluat)\w*\s+(?:arbitrary\s+)?(?:python|javascript|typescript|js)?\s*code\b/i,
  },
  {
    capability: 'filesystem.write',
    name: (w) =>
      both(
        has(
          w,
          'write',
          'create',
          'delete',
          'remove',
          'move',
          'rename',
          'edit',
          'append',
          'mkdir',
          'rm',
          'save',
          'overwrite',
          'copy',
        ),
        has(w, 'file', 'files', 'directory', 'dir', 'folder', 'path'),
      ),
    text: /\b(?:writes?|creates?|deletes?|overwrites?|modif(?:y|ies)|moves?|renames?)\s+(?:a\s+|the\s+|new\s+)?(?:files?|director(?:y|ies)|folders?)\b/i,
  },
  {
    capability: 'filesystem.read',
    name: (w) =>
      both(
        has(w, 'read', 'list', 'get', 'search', 'stat', 'tree', 'find', 'glob', 'view', 'open'),
        has(w, 'file', 'files', 'directory', 'directories', 'dir', 'folder'),
      ),
    text: /\b(?:reads?|lists?)\s+(?:the\s+)?(?:contents?\s+of\s+)?(?:a\s+|the\s+)?(?:files?|director(?:y|ies))\b/i,
  },
  {
    capability: 'network.fetch',
    name: (w) =>
      has(w, 'fetch', 'http', 'curl', 'download', 'scrape', 'crawl', 'webhook') ??
      both(has(w, 'get', 'open', 'read'), has(w, 'url', 'webpage', 'website')),
    param: /^(?:url|uri|endpoint|href|webhook_?url)$/i,
    text: /\b(?:fetch|fetches|downloads?|requests?)\s+(?:a\s+|the\s+|any\s+)?(?:url|web\s?page|website|http)/i,
  },
  {
    capability: 'browser.control',
    name: (w) =>
      has(
        w,
        'browser',
        'navigate',
        'click',
        'screenshot',
        'playwright',
        'puppeteer',
        'hover',
        'keypress',
      ),
  },
  {
    capability: 'messaging.send',
    name: (w) =>
      both(
        has(w, 'send', 'post', 'reply', 'publish', 'notify', 'forward', 'broadcast'),
        has(
          w,
          'email',
          'mail',
          'message',
          'messages',
          'slack',
          'sms',
          'tweet',
          'dm',
          'chat',
          'channel',
          'comment',
          'notification',
        ),
      ),
    text: /\b(?:sends?|posts?|publish(?:es)?)\s+(?:an?\s+|the\s+)?(?:email|message|slack\s+message|sms|tweet|notification)s?\b/i,
  },
  {
    capability: 'payments',
    name: (w) => has(w, 'payment', 'payments', 'charge', 'refund', 'invoice', 'payout', 'checkout'),
    text: /\b(?:charges?\s+(?:a\s+|the\s+)?(?:card|customer)|refunds?\s+(?:a\s+|the\s+)?(?:payment|charge)|transfers?\s+funds)\b/i,
  },
  {
    capability: 'database.write',
    name: (w) =>
      both(
        has(w, 'insert', 'update', 'delete', 'drop', 'truncate', 'upsert', 'migrate', 'alter'),
        has(
          w,
          'row',
          'rows',
          'record',
          'records',
          'table',
          'tables',
          'database',
          'db',
          'sql',
          'collection',
        ),
      ) ?? both(has(w, 'execute', 'exec', 'run', 'apply'), has(w, 'sql', 'migration')),
    text: /\b(?:execut|run)\w*\s+(?:a\s+|any\s+|arbitrary\s+|raw\s+)?sql\b/i,
  },
  {
    capability: 'database.read',
    name: (w) =>
      has(w, 'sql', 'select') ??
      both(
        has(w, 'query', 'list', 'get', 'describe'),
        has(w, 'table', 'tables', 'schema', 'database', 'db', 'rows'),
      ),
  },
  {
    capability: 'vcs.write',
    name: (w) =>
      has(w, 'push', 'merge', 'commit') ??
      both(
        has(w, 'create', 'delete', 'update', 'close'),
        has(w, 'branch', 'repository', 'repo', 'pull', 'release', 'tag'),
      ),
  },
  {
    capability: 'credentials',
    name: (w) =>
      has(w, 'secret', 'secrets', 'credential', 'credentials', 'password', 'passwords') ??
      both(has(w, 'get', 'read', 'list', 'print', 'dump'), has(w, 'env', 'environment')),
    param: /^(?:password|passwd|secret|token|api_?key|private_?key|access_?token|client_?secret)$/i,
  },
];

function topParams(schema: unknown): string[] {
  const props = (schema as { properties?: unknown } | null)?.properties;
  return props && typeof props === 'object' && !Array.isArray(props) ? Object.keys(props) : [];
}

export function toolCapabilities(tool: McpTool): CapabilityHit[] {
  const w = words(tool.name);
  const params = topParams(tool.inputSchema);
  const desc = tool.description ?? '';
  const hits: CapabilityHit[] = [];
  for (const rule of RULES) {
    const token = rule.name?.(w);
    if (token) {
      hits.push({ capability: rule.capability, evidence: `name "${tool.name}" (${token})` });
      continue;
    }
    const param = rule.param ? params.find((p) => rule.param!.test(p)) : undefined;
    if (param) {
      hits.push({ capability: rule.capability, evidence: `parameter "${param}"` });
      continue;
    }
    const m = rule.text?.exec(desc);
    if (m) hits.push({ capability: rule.capability, evidence: `description: "${m[0]}"` });
  }
  return hits;
}

// ── Findings ──────────────────────────────────────────────────────────────────

export type FindingKind =
  | 'hidden_characters'
  | 'instruction_override'
  | 'model_directive'
  | 'concealment'
  | 'exfiltration'
  | 'sensitive_path'
  | 'suspicious_url'
  | 'oversized_text'
  | 'annotation_mismatch'
  | 'tool_collision'
  | 'cross_server_reference'
  | 'parse_issues';

export interface McpFinding {
  kind: FindingKind;
  severity: Severity;
  /** Server alias, for findings in a multi-server report. */
  server?: string;
  tool: string | null;
  /** `description`, `inputSchema.path.description`, `instructions`, `prompt summarize`, … */
  where: string;
  detail: string;
  /** The matched text, trimmed, with invisible characters made visible. */
  evidence: string | null;
}

/** Unicode Tags block: invisible, and decodes to ASCII. The smuggling channel. */
const TAG_CHARS = /[\u{E0000}-\u{E007F}]/gu;
/** Bidirectional overrides: reorder what a human reviewer sees. */
const BIDI = /[\u202A-\u202E\u2066-\u2069]/g;
/**
 * Zero-width and invisible formatting characters. U+200D (joiner) and U+FE0F
 * (emoji presentation) are excluded: every multi-person or skin-tone emoji
 * contains them, and they cannot hide text on their own.
 */
const INVISIBLE = /[\u200B\u200C\u200E\u200F\u2060-\u2064\uFEFF]/g;

const OVERRIDE =
  /\b(?:ignore|disregard|forget|override|bypass)\b[^.\n]{0,40}?\b(?:previous|prior|above|earlier|all|any|other|system|safety)\b[^.\n]{0,30}?\b(?:instructions?|prompts?|rules|guidelines|directives|messages|constraints)\b/i;
const ROLE_TAG = /<\s*\/?\s*(?:important|system|instructions?|secret|hidden|admin|override)\s*>/i;
const DIRECTIVE =
  /\b(?:before|prior\s+to)\s+(?:using|calling|invoking|running)\s+(?:this|any|other|the\s+\w+)\s+tools?\b[^.\n]{0,80}?\b(?:you\s+must|must|always|first)\b|\byou\s+must\s+(?:always\s+)?(?:first\s+)?(?:call|invoke|read|send|include|pass)\b[^.\n]{0,50}?\b(?:before|every\s+time|with\s+every|other\s+tools?)\b/i;
const CONCEAL =
  /\b(?:do\s+not|don't|never|avoid)\s+(?:tell|telling|inform|informing|mention|mentioning|reveal|revealing|notify|notifying|alert|alerting)\b[^.\n]{0,30}?\b(?:the\s+)?users?\b|\bwithout\s+(?:asking|telling|informing|notifying)\s+(?:the\s+)?users?\b/i;
const SENSITIVE =
  /~\/\.ssh\b|\bid_(?:rsa|ed25519|ecdsa)\b|\.aws\/credentials|(?:^|[\s"'`(/])\.env\b|\bmcp\.json\b|\.claude\.json\b|\.npmrc\b|\.netrc\b|\.git-credentials\b|\/etc\/(?:passwd|shadow)\b|\bprivate[_\s-]key\b/i;
const EXFIL =
  /\b(?:send|post|upload|forward|transmit|include|append|pass|copy)\b[^.\n]{0,40}?\b(?:conversation|chat\s+history|system\s+prompt|previous\s+messages|credentials|ssh\s+keys?|contents\s+of\s+(?:the\s+)?(?:~|\.|file|user))/i;
const COLLECTOR_HOST =
  /https?:\/\/[^\s"')]*(?:ngrok(?:-free)?\.(?:io|app|dev)|webhook\.site|requestbin|pipedream\.net|burpcollaborator|interact\.sh|oast\.(?:fun|live|site|pro|online|me))/i;
const RAW_IP_URL = /https?:\/\/(?:\d{1,3}\.){3}\d{1,3}(?::\d+)?\//i;

const OVERSIZED_DESCRIPTION = 8_000;

function visible(s: string): string {
  return s
    .replace(TAG_CHARS, (c) => `\\u{${c.codePointAt(0)!.toString(16).toUpperCase()}}`)
    .replace(BIDI, (c) => `\\u${c.charCodeAt(0).toString(16).toUpperCase()}`)
    .replace(INVISIBLE, (c) => `\\u${c.charCodeAt(0).toString(16).toUpperCase()}`)
    .replace(/\s+/g, ' ')
    .trim();
}

function snippet(text: string, index: number, length: number): string {
  const start = Math.max(0, index - 40);
  const end = Math.min(text.length, index + length + 40);
  return `${start > 0 ? '…' : ''}${visible(text.slice(start, end))}${end < text.length ? '…' : ''}`.slice(
    0,
    240,
  );
}

/** Text smuggled in Unicode tag characters, decoded. */
export function decodeTags(text: string): string {
  let out = '';
  for (const ch of text) {
    const cp = ch.codePointAt(0)!;
    if (cp >= 0xe0020 && cp <= 0xe007e) out += String.fromCharCode(cp - 0xe0000);
  }
  return out;
}

interface TextSite {
  tool: string | null;
  where: string;
  text: string;
}

/** Every human-language string a tool puts in front of the model. Bounded. */
function toolTexts(tool: McpTool): TextSite[] {
  const sites: TextSite[] = [];
  if (tool.title) sites.push({ tool: tool.name, where: 'title', text: tool.title });
  if (tool.description)
    sites.push({ tool: tool.name, where: 'description', text: tool.description });
  for (const [root, schema] of [
    ['inputSchema', tool.inputSchema],
    ['outputSchema', tool.outputSchema],
  ] as const) {
    const stack: [unknown, string, number][] = [[schema, root, 0]];
    while (stack.length && sites.length < 500) {
      const [node, path, depth] = stack.pop()!;
      if (!node || typeof node !== 'object' || depth > 20) continue;
      for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
        if ((k === 'description' || k === 'title') && typeof v === 'string') {
          sites.push({ tool: tool.name, where: `${path}.${k}`, text: v });
        } else if (v && typeof v === 'object') {
          stack.push([v, `${path}.${k}`, depth + 1]);
        }
      }
    }
  }
  return sites;
}

function promptTexts(p: PromptInfo): TextSite[] {
  const sites: TextSite[] = [];
  if (p.description) sites.push({ tool: null, where: `prompt ${p.name}`, text: p.description });
  for (const a of p.arguments) {
    if (a.description)
      sites.push({ tool: null, where: `prompt ${p.name}.${a.name}`, text: a.description });
  }
  return sites;
}

/** Scan one text site. Pure pattern work; escalation across sites happens above. */
export function scanText(site: TextSite): McpFinding[] {
  const out: McpFinding[] = [];
  const { text, tool, where } = site;
  const add = (kind: FindingKind, severity: Severity, detail: string, evidence: string | null) =>
    out.push({ kind, severity, tool, where, detail, evidence });

  const tags = text.match(TAG_CHARS);
  if (tags) {
    const decoded = decodeTags(text);
    add(
      'hidden_characters',
      'high',
      `${tags.length} invisible Unicode tag character(s); they decode to text the model reads and a human reviewer cannot see`,
      decoded ? `decodes to: "${decoded.slice(0, 200)}"` : null,
    );
  }
  const bidi = BIDI.exec(text);
  BIDI.lastIndex = 0;
  if (bidi) {
    add(
      'hidden_characters',
      'high',
      'bidirectional override characters reorder what a reviewer sees',
      snippet(text, bidi.index, 1),
    );
  }
  const invisible = text.match(INVISIBLE);
  if (invisible) {
    add(
      'hidden_characters',
      'moderate',
      `${invisible.length} zero-width character(s)`,
      snippet(text, text.search(INVISIBLE), 1),
    );
  }

  // The remaining patterns read the text as the model does, with invisibles gone.
  const plain = text.replace(TAG_CHARS, '').replace(BIDI, '').replace(INVISIBLE, '');
  const match = (re: RegExp) => re.exec(plain);

  const override = match(OVERRIDE) ?? match(ROLE_TAG);
  if (override) {
    add(
      'instruction_override',
      'high',
      'tells the model to set aside its other instructions',
      snippet(plain, override.index, override[0].length),
    );
  }
  const conceal = match(CONCEAL);
  if (conceal) {
    add(
      'concealment',
      'high',
      'tells the model to keep something from the user',
      snippet(plain, conceal.index, conceal[0].length),
    );
  }
  const directive = match(DIRECTIVE);
  if (directive) {
    add(
      'model_directive',
      'moderate',
      'instructs the model how to use other tools, not just this one',
      snippet(plain, directive.index, directive[0].length),
    );
  }
  const exfil = match(EXFIL);
  const sensitive = match(SENSITIVE);
  if (exfil) {
    add(
      'exfiltration',
      'high',
      'asks for conversation or credential material to be sent through a tool',
      snippet(plain, exfil.index, exfil[0].length),
    );
  }
  if (sensitive) {
    // A path alone is common in legitimate docs ("reads your .env"). Paired
    // with any steering language it is the canonical poisoning payload.
    const steering = override || conceal || directive || exfil;
    add(
      steering ? 'exfiltration' : 'sensitive_path',
      steering ? 'critical' : 'low',
      steering
        ? 'names a credential file alongside instructions to the model — the tool-poisoning pattern'
        : 'mentions a credential file or secret location',
      snippet(plain, sensitive.index, sensitive[0].length),
    );
  }
  const host = match(COLLECTOR_HOST);
  if (host) {
    add(
      'suspicious_url',
      'high',
      'references a request-capture or tunnelling host',
      snippet(plain, host.index, host[0].length),
    );
  } else {
    const ip = match(RAW_IP_URL);
    if (ip)
      add(
        'suspicious_url',
        'moderate',
        'references a raw IP address url',
        snippet(plain, ip.index, ip[0].length),
      );
  }
  if (where === 'description' && text.length > OVERSIZED_DESCRIPTION) {
    add(
      'oversized_text',
      'info',
      `description is ${text.length} characters, all of it in the model's context on every request`,
      null,
    );
  }
  return out;
}

export interface ServerStats {
  tools: number;
  /** By resolved annotations: undeclared counts as writing. */
  writes: number;
  destroys: number;
  openWorld: number;
  /** Tools that declare any annotation at all. */
  annotated: number;
  capabilities: Partial<Record<Capability, number>>;
}

export interface ServerAnalysis {
  capabilities: Record<string, CapabilityHit[]>;
  findings: McpFinding[];
  stats: ServerStats;
}

export function analyzeServer(
  snapshot: Pick<Snapshot, 'tools' | 'prompts' | 'resourceTemplates' | 'instructions' | 'issues'>,
): ServerAnalysis {
  const capabilities: Record<string, CapabilityHit[]> = {};
  const findings: McpFinding[] = [];
  const stats: ServerStats = {
    tools: snapshot.tools.length,
    writes: 0,
    destroys: 0,
    openWorld: 0,
    annotated: 0,
    capabilities: {},
  };

  for (const tool of snapshot.tools) {
    const ann = resolveAnnotations(tool.annotations);
    if (!ann.readOnlyHint) stats.writes++;
    if (ann.destructiveHint) stats.destroys++;
    if (ann.openWorldHint) stats.openWorld++;
    if (tool.annotations && Object.keys(tool.annotations).some((k) => k !== 'title'))
      stats.annotated++;

    const hits = toolCapabilities(tool);
    if (hits.length) capabilities[tool.name] = hits;
    for (const h of hits)
      stats.capabilities[h.capability] = (stats.capabilities[h.capability] ?? 0) + 1;

    // The server's claim against an independent reading of the same tool.
    const writing = hits.find((h) => WRITE_CAPABILITIES.has(h.capability));
    if (tool.annotations?.readOnlyHint === true && writing) {
      findings.push({
        kind: 'annotation_mismatch',
        severity: 'moderate',
        tool: tool.name,
        where: 'annotations.readOnlyHint',
        detail: `declares itself read-only, but reads as ${writing.capability}; a client that auto-approves read-only tools would run it unasked`,
        evidence: writing.evidence,
      });
    }

    const sites = toolTexts(tool);
    for (const site of sites) findings.push(...scanText(site));
  }

  for (const p of snapshot.prompts)
    for (const site of promptTexts(p)) findings.push(...scanText(site));
  for (const t of snapshot.resourceTemplates) {
    if (t.description)
      findings.push(
        ...scanText({ tool: null, where: `resource template ${t.name}`, text: t.description }),
      );
  }
  if (snapshot.instructions)
    findings.push(...scanText({ tool: null, where: 'instructions', text: snapshot.instructions }));

  const dupes = snapshot.issues.filter((i) => i.kind === 'duplicate');
  if (dupes.length) {
    findings.push({
      kind: 'parse_issues',
      severity: 'moderate',
      tool: null,
      where: 'tools/list',
      detail: `${dupes.length} name(s) listed twice; clients disagree on which copy an agent gets`,
      evidence: dupes
        .map((d) => d.detail)
        .slice(0, 3)
        .join('; '),
    });
  }
  const malformed = snapshot.issues.filter(
    (i) => i.kind === 'malformed' || i.kind === 'stdout_noise',
  );
  if (malformed.length) {
    findings.push({
      kind: 'parse_issues',
      severity: 'low',
      tool: null,
      where: 'tools/list',
      detail: `${malformed.length} protocol issue(s); stricter clients may reject this server's list`,
      evidence: malformed
        .map((d) => d.detail)
        .slice(0, 3)
        .join('; '),
    });
  }

  return { capabilities, findings: sortFindings(findings), stats };
}

export function sortFindings(findings: McpFinding[]): McpFinding[] {
  return [...findings].sort(
    (a, b) =>
      SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity] ||
      (a.tool ?? '').localeCompare(b.tool ?? ''),
  );
}

export function worst(findings: { severity: Severity }[]): Severity | null {
  return findings.reduce<Severity | null>(
    (w, f) => (w === null || SEVERITY_RANK[f.severity] < SEVERITY_RANK[w] ? f.severity : w),
    null,
  );
}

// ── Across servers ────────────────────────────────────────────────────────────

export interface ScanMember {
  alias: string;
  snapshot: Pick<
    Snapshot,
    'tools' | 'prompts' | 'resourceTemplates' | 'instructions' | 'issues'
  > | null;
}

export interface StackAnalysis {
  stack: McpStackReport;
  /** Collisions and cross-server references, as findings. */
  findings: McpFinding[];
}

/**
 * Is a tool name distinctive enough that seeing it in another server's prose
 * is a reference rather than a coincidence? `search` is a word; `send_email`
 * is a name.
 */
const distinctive = (name: string) => name.length >= 6 && /[_-]|[a-z][A-Z]/.test(name);

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * What only shows up when servers are wired together: name collisions, and a
 * server whose descriptions talk about ANOTHER server's tools — the shadowing
 * attack, where a harmless-looking tool instructs the model how to use the
 * trusted one ("when send_email is called, also BCC…").
 */
export function analyzeStackScan(members: ScanMember[]): StackAnalysis {
  const stack = analyzeStack(
    members.map((m) => ({
      server: m.alias,
      version: null,
      tools: m.snapshot
        ? m.snapshot.tools.map((t) => ({
            name: t.name,
            annotations: resolveAnnotations(t.annotations),
          }))
        : null,
    })),
  );
  const findings: McpFinding[] = stack.collisions.map((c) => ({
    kind: 'tool_collision' as const,
    severity: c.writes ? ('high' as const) : ('moderate' as const),
    tool: c.tool,
    where: 'tool namespace',
    detail: `exposed by ${c.servers.join(' and ')}; the agent cannot say which one it means${c.writes ? ', and one of them can modify something' : ''}`,
    evidence: null,
  }));

  const read = members.filter(
    (m): m is ScanMember & { snapshot: NonNullable<ScanMember['snapshot']> } => !!m.snapshot,
  );
  for (const owner of read) {
    const foreign = read
      .filter((m) => m !== owner)
      .flatMap((m) =>
        m.snapshot.tools
          .filter((t) => distinctive(t.name))
          .map((t) => ({ server: m.alias, name: t.name })),
      )
      // A name the owner also exposes is a collision, already reported.
      .filter((f) => !owner.snapshot.tools.some((t) => t.name === f.name));
    if (!foreign.length) continue;
    const pattern = new RegExp(`\\b(${foreign.map((f) => escapeRe(f.name)).join('|')})\\b`);

    for (const tool of owner.snapshot.tools) {
      for (const site of toolTexts(tool)) {
        const m = pattern.exec(site.text);
        if (!m) continue;
        const target = foreign.find((f) => f.name === m[1])!;
        const steering = scanText(site).some(
          (f) => f.severity === 'high' || f.severity === 'critical',
        );
        findings.push({
          kind: 'cross_server_reference',
          severity: steering ? 'high' : 'moderate',
          server: owner.alias,
          tool: tool.name,
          where: site.where,
          detail: `describes ${target.server}'s tool "${target.name}"${steering ? ' while instructing the model' : ''}; a server steering another server's tools is the shadowing pattern`,
          evidence: snippet(site.text, m.index, m[0].length),
        });
      }
    }
  }
  return { stack, findings: sortFindings(findings) };
}

// ── Over time ─────────────────────────────────────────────────────────────────

export type DiffInput = Pick<
  Snapshot,
  'tools' | 'prompts' | 'resourceTemplates' | 'instructions'
> & {
  issues?: Snapshot['issues'];
};

export interface SnapshotDiff {
  contract: McpDrift;
  descriptionChanges: {
    tool: string;
    field: 'description' | 'title';
    before: string | null;
    after: string | null;
  }[];
  instructionsChanged: boolean;
  promptsAdded: string[];
  promptsRemoved: string[];
  capabilitiesGained: { tool: string; capabilities: Capability[] }[];
  /** Findings present now that were not before. */
  newFindings: McpFinding[];
  /**
   * Tools whose text changed AND now carries a high or critical finding: the
   * server was approved in one form and is now saying something else to the
   * model.
   */
  rugPull: string[];
  severity: Severity;
  summary: string;
  /** Nothing the model can see changed. */
  unchanged: boolean;
}

const findingKey = (f: McpFinding) => `${f.kind}|${f.tool ?? ''}|${f.where}|${f.evidence ?? ''}`;

const MAX_TEXT_CHANGES = 50;

export function diffSnapshots(prev: DiffInput, next: DiffInput, label = 'server'): SnapshotDiff {
  const contract = diffMcpSurfaces(
    mcpSurface(label, null, prev.tools),
    mcpSurface(label, null, next.tools),
  );

  const before = new Map(prev.tools.map((t) => [t.name, t]));
  const descriptionChanges: SnapshotDiff['descriptionChanges'] = [];
  const capabilitiesGained: SnapshotDiff['capabilitiesGained'] = [];
  const changedText = new Set<string>();
  for (const t of next.tools) {
    const old = before.get(t.name);
    if (!old) continue;
    for (const field of ['description', 'title'] as const) {
      if ((old[field] ?? null) !== (t[field] ?? null)) {
        changedText.add(t.name);
        if (descriptionChanges.length < MAX_TEXT_CHANGES) {
          descriptionChanges.push({
            tool: t.name,
            field,
            before: old[field] ?? null,
            after: t[field] ?? null,
          });
        }
      }
    }
    const had = new Set(toolCapabilities(old).map((h) => h.capability));
    const gained = toolCapabilities(t)
      .map((h) => h.capability)
      .filter((c) => !had.has(c));
    if (gained.length) capabilitiesGained.push({ tool: t.name, capabilities: gained });
  }

  const empty = { issues: [] as Snapshot['issues'] };
  const prevKeys = new Set(analyzeServer({ ...empty, ...prev }).findings.map(findingKey));
  const newFindings = analyzeServer({ ...empty, ...next }).findings.filter(
    (f) => !prevKeys.has(findingKey(f)),
  );

  const rugPull = [
    ...new Set(
      newFindings
        .filter(
          (f) =>
            f.tool &&
            changedText.has(f.tool) &&
            (f.severity === 'high' || f.severity === 'critical'),
        )
        .map((f) => f.tool!),
    ),
  ].sort();

  const prevPrompts = new Set(prev.prompts.map((p) => p.name));
  const nextPrompts = new Set(next.prompts.map((p) => p.name));
  const promptsAdded = [...nextPrompts].filter((p) => !prevPrompts.has(p)).sort();
  const promptsRemoved = [...prevPrompts].filter((p) => !nextPrompts.has(p)).sort();
  const instructionsChanged = (prev.instructions ?? null) !== (next.instructions ?? null);

  const writingGained = capabilitiesGained.some((g) =>
    g.capabilities.some((c) => WRITE_CAPABILITIES.has(c)),
  );
  const widened = contract.annotationFlips.some((f) => f.widensPrivilege);
  const findingWorst = worst(newFindings);

  let severity: Severity = 'info';
  const raise = (s: Severity) => {
    if (SEVERITY_RANK[s] < SEVERITY_RANK[severity]) severity = s;
  };
  if (rugPull.length) raise('critical');
  if (findingWorst) raise(findingWorst);
  if (widened || contract.silentDrift.length) raise('high');
  if (contract.breaking || writingGained || instructionsChanged) raise('moderate');
  if (
    contract.addedTools.length ||
    descriptionChanges.length ||
    promptsAdded.length ||
    promptsRemoved.length ||
    capabilitiesGained.length
  ) {
    raise('low');
  }

  const parts: string[] = [];
  if (rugPull.length)
    parts.push(
      `${rugPull.length} tool(s) rewrote their description and now instruct the model: ${rugPull.join(', ')}`,
    );
  const drift = contract.inconclusive
    ? `contract not comparable (${contract.inconclusive})`
    : summarizeDrift(contract);
  if (drift !== 'no contract change') parts.push(drift);
  if (descriptionChanges.length && !rugPull.length)
    parts.push(`${changedText.size} tool description(s) changed`);
  if (instructionsChanged) parts.push('server instructions changed');
  if (promptsAdded.length) parts.push(`${promptsAdded.length} prompt(s) added`);
  if (promptsRemoved.length) parts.push(`${promptsRemoved.length} prompt(s) removed`);
  if (writingGained) parts.push('a tool gained the ability to modify something');
  const serious = newFindings.filter((f) => f.severity === 'critical' || f.severity === 'high');
  if (serious.length && !rugPull.length)
    parts.push(`${serious.length} new high-severity finding(s)`);

  const unchanged =
    !contract.addedTools.length &&
    !contract.removedTools.length &&
    !contract.silentDrift.length &&
    !contract.annotationFlips.length &&
    !contract.typeChanged.length &&
    !contract.paramsAdded.length &&
    !contract.paramsRemoved.length &&
    !contract.requiredAdded.length &&
    !contract.requiredRelaxed.length &&
    !contract.outputChanged.length &&
    !descriptionChanges.length &&
    !instructionsChanged &&
    !promptsAdded.length &&
    !promptsRemoved.length;

  return {
    contract,
    descriptionChanges,
    instructionsChanged,
    promptsAdded,
    promptsRemoved,
    capabilitiesGained,
    newFindings,
    rugPull,
    severity,
    summary: parts.length ? parts.join('; ') : unchanged ? 'no change' : 'minor changes',
    unchanged,
  };
}
