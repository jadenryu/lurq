/**
 * Persistent per-user CLI credentials: `~/.lurq/config.json`.
 *
 * `lurq setup` writes the API key here once, and every later command reads it
 * back. That is what makes a global `npm i -g lurqrun` install usable in any
 * directory without exporting `LURQ_API_KEY` in a shell profile first. The key
 * is also written into each agent's MCP config, but those files belong to the
 * agents; this one belongs to the CLI.
 *
 * Nothing else lives here. Weights have their own file (`~/.config/lurq/
 * weights.json`), and server-side settings stay in the environment.
 */
import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

export interface UserConfig {
  apiKey?: string;
  /** Only stored when it differs from the built-in default (self-hosted service). */
  endpoint?: string;
}

/** `~/.lurq`, also where the agent instruction template is copied. */
export function lurqHome(): string {
  return process.env.LURQ_HOME || join(homedir(), '.lurq');
}

export function userConfigPath(): string {
  return join(lurqHome(), 'config.json');
}

/** Read the stored config. Returns `{}` when absent, empty, or corrupt: a
 *  hand-mangled config file should not make every command throw. */
export function readUserConfig(): UserConfig {
  const path = userConfigPath();
  if (!existsSync(path)) return {};
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8'));
    return parsed && typeof parsed === 'object' ? (parsed as UserConfig) : {};
  } catch {
    return {};
  }
}

/**
 * Merge into the stored config and write it back at mode 0600.
 *
 * The file holds a live credential, so it is written owner-only and via
 * temp-file + rename: an interrupted write leaves the previous key intact
 * rather than a truncated file that reads as "no key configured". `chmod`
 * happens on the temp file, before the rename, so the key is never briefly
 * world-readable at its final path.
 */
export function writeUserConfig(patch: UserConfig): string {
  const path = userConfigPath();
  const next = { ...readUserConfig(), ...patch };
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.${process.pid}.tmp`;
  try {
    writeFileSync(tmp, JSON.stringify(next, null, 2) + '\n', { mode: 0o600 });
    chmodSync(tmp, 0o600);
    renameSync(tmp, path);
  } catch (err) {
    try {
      rmSync(tmp, { force: true });
    } catch {
      /* best-effort cleanup; report the original failure */
    }
    throw err;
  }
  return path;
}

/** Remove the stored credentials (`lurq logout`). Returns false if none existed. */
export function clearUserConfig(): boolean {
  const path = userConfigPath();
  if (!existsSync(path)) return false;
  rmSync(path, { force: true });
  return true;
}

/**
 * The API key to use, in precedence order: an explicit flag, then the
 * environment (CI sets `LURQ_API_KEY` as a secret), then the stored config.
 *
 * The environment deliberately beats the stored file so a CI runner or a
 * one-off `LURQ_API_KEY=… lurq …` overrides a developer's saved key rather than
 * being silently ignored.
 */
export function resolveApiKey(override?: string): string | undefined {
  return override?.trim() || process.env.LURQ_API_KEY?.trim() || readUserConfig().apiKey?.trim();
}

/** Same precedence as `resolveApiKey`, for the hosted endpoint URL. */
export function resolveEndpoint(override?: string): string | undefined {
  return override?.trim() || process.env.LURQ_ENDPOINT?.trim() || readUserConfig().endpoint?.trim();
}
