/**
 * The exact config to paste, per client, for a remote server.
 *
 * Rendered from each client's documented template (`./profiles`), so a user is
 * handed the key names that client actually reads — `mcpServers` versus
 * `servers` versus `context_servers`, `url` versus `httpUrl` versus
 * `serverUrl` — rather than one generic snippet that silently fails in half of
 * them.
 *
 * Header values are always placeholders. A rendered snippet can end up in a
 * chat log, a PR or a public page; a real key must never be in one.
 */
import type { ClientProfile } from './types';

export interface RenderInput {
  name: string;
  url: string;
  /** Header names to include, each rendered with a placeholder value. */
  headers: string[];
}

export interface RenderedConfig {
  kind: 'json' | 'toml' | 'yaml' | 'command' | 'deeplink';
  /** Where it goes: a file path, or "terminal" / "browser". */
  target: string;
  text: string;
}

export const placeholderFor = (header: string) =>
  /^authorization$/i.test(header)
    ? 'Bearer <your-token>'
    : `<your-${header.toLowerCase().replace(/[^a-z0-9]+/g, '-')}>`;

const headerObject = (names: string[]) =>
  Object.fromEntries(names.map((h) => [h, placeholderFor(h)]));

function entry(client: ClientProfile, input: RenderInput): Record<string, unknown> {
  const t = client.config.remote!;
  const e: Record<string, unknown> = {};
  if (t.typeKey && t.typeValue) e[t.typeKey] = t.typeValue;
  e[t.urlKey] = input.url;
  if (t.headersKey && input.headers.length) e[t.headersKey] = headerObject(input.headers);
  return e;
}

const tomlString = (s: string) => JSON.stringify(s);
const tomlKey = (s: string) => (/^[A-Za-z0-9_-]+$/.test(s) ? s : JSON.stringify(s));

function renderFile(client: ClientProfile, input: RenderInput): RenderedConfig {
  const t = client.config.remote!;
  const e = entry(client, input);
  if (/\.toml\b/.test(t.file)) {
    const lines = [`[${t.containerKey}.${tomlKey(input.name)}]`];
    const nested: [string, Record<string, string>][] = [];
    for (const [k, v] of Object.entries(e)) {
      if (v && typeof v === 'object') nested.push([k, v as Record<string, string>]);
      else lines.push(`${tomlKey(k)} = ${tomlString(String(v))}`);
    }
    for (const [k, obj] of nested) {
      lines.push('', `[${t.containerKey}.${tomlKey(input.name)}.${tomlKey(k)}]`);
      for (const [hk, hv] of Object.entries(obj)) lines.push(`${tomlKey(hk)} = ${tomlString(hv)}`);
    }
    return { kind: 'toml', target: t.file, text: lines.join('\n') };
  }
  if (/\.ya?ml\b/.test(t.file)) {
    const lines = [`${t.containerKey}:`, `  ${input.name}:`];
    for (const [k, v] of Object.entries(e)) {
      if (v && typeof v === 'object') {
        lines.push(`    ${k}:`);
        for (const [hk, hv] of Object.entries(v as Record<string, string>))
          lines.push(`      ${hk}: ${JSON.stringify(hv)}`);
      } else lines.push(`    ${k}: ${JSON.stringify(v)}`);
    }
    return { kind: 'yaml', target: t.file, text: lines.join('\n') };
  }
  return {
    kind: 'json',
    target: t.file,
    text: JSON.stringify({ [t.containerKey]: { [input.name]: e } }, null, 2),
  };
}

function renderCommand(template: string, input: RenderInput): string {
  const shellQuote = (s: string) =>
    /^[A-Za-z0-9_./:@%+=-]+$/.test(s) ? s : `'${s.replace(/'/g, `'\\''`)}'`;
  let cmd = template;
  const headerPart = /\s*--header\s+"\{header\}"/.exec(cmd);
  if (headerPart) {
    const repeated = input.headers.map((h) => ` --header "${h}: ${placeholderFor(h)}"`).join('');
    cmd = cmd.replace(headerPart[0], repeated);
  }
  return cmd
    .replace(/\{name\}/g, shellQuote(input.name))
    .replace(/\{url\}/g, shellQuote(input.url));
}

/** Deeplinks whose `{config}` encoding a primary source documents. */
function renderDeeplink(client: ClientProfile, input: RenderInput): string | null {
  const link = client.config.deeplink;
  if (!link) return null;
  const headers = input.headers.length ? { headers: headerObject(input.headers) } : {};
  switch (client.id) {
    case 'cursor': {
      const config = Buffer.from(JSON.stringify({ url: input.url, ...headers })).toString('base64');
      return link
        .replace('{name}', encodeURIComponent(input.name))
        .replace('{config}', encodeURIComponent(config));
    }
    case 'vscode':
      return link.replace(
        '{config}',
        encodeURIComponent(
          JSON.stringify({ name: input.name, type: 'http', url: input.url, ...headers }),
        ),
      );
    case 'goose':
      return input.headers.length
        ? null
        : link
            .replace('{url}', encodeURIComponent(input.url))
            .replace(/\{name\}/g, encodeURIComponent(input.name));
    default:
      return null;
  }
}

export function renderClientConfig(client: ClientProfile, input: RenderInput): RenderedConfig[] {
  const out: RenderedConfig[] = [];
  if (client.config.remote) out.push(renderFile(client, input));
  // A command that cannot carry the headers the server needs would register a
  // server that fails on first use; the config file is the honest option then.
  const command = client.config.addCommand;
  if (command && (input.headers.length === 0 || command.includes('{header}'))) {
    out.push({ kind: 'command', target: 'terminal', text: renderCommand(command, input) });
  }
  const link = renderDeeplink(client, input);
  if (link) out.push({ kind: 'deeplink', target: 'browser', text: link });
  return out;
}
