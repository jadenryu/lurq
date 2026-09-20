/**
 * One-click install links for editors that register an MCP server from a URL.
 *
 * The docs carry these as literal links (apps/docs quickstart, "One-click
 * install"), and tests/installLinks.test.ts fails when the docs and this file
 * disagree, so a changed endpoint cannot leave a stale button behind.
 *
 * The key is a placeholder the user replaces. A link carrying a real key would
 * be a credential sitting in a web page, and `npx lurqrun` remains the path that
 * needs no paste at all.
 */
import { DEFAULT_ENDPOINT } from '../core/constants';

export const KEY_PLACEHOLDER = '<your-lurq-api-key>';

const headers = (agent: string) => ({
  Authorization: `Bearer ${KEY_PLACEHOLDER}`,
  'X-Lurq-Client': agent,
});

/**
 * Cursor: base64 of the server entry itself, not wrapped in its name
 * (cursor.com/docs/context/mcp/install-links). Same shape setup writes for
 * Cursor: `url` + `headers`, no `type`.
 */
export function cursorInstallLink(): string {
  const config = Buffer.from(
    JSON.stringify({ url: DEFAULT_ENDPOINT, headers: headers('cursor') }),
  ).toString('base64');
  return `cursor://anysphere.cursor-deeplink/mcp/install?name=lurq&config=${encodeURIComponent(config)}`;
}

/**
 * VS Code: the named entry, JSON-stringified and URL-encoded
 * (code.visualstudio.com/api/extension-guides/ai/mcp). Same shape setup writes
 * for VS Code: `type: "http"` + `url` + `headers`.
 */
export function vscodeInstallLink(): string {
  const entry = { name: 'lurq', type: 'http', url: DEFAULT_ENDPOINT, headers: headers('copilot') };
  return `vscode:mcp/install?${encodeURIComponent(JSON.stringify(entry))}`;
}
