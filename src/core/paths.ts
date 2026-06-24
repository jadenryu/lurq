/**
 * Locate package-relative resources at runtime. Works in dev (tsx, source under
 * src/) and when published (bundled under dist/), by walking up from this module
 * until a directory containing package.json is found.
 */
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

let cachedRoot: string | undefined;

/** Absolute path to the installed lurq package root (the dir with package.json). */
export function packageRoot(): string {
  if (cachedRoot) return cachedRoot;
  let dir = dirname(fileURLToPath(import.meta.url));
  // Walk up to the filesystem root looking for our package.json.
  for (;;) {
    if (existsSync(join(dir, 'package.json'))) {
      cachedRoot = dir;
      return dir;
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  // Fallback: current working directory.
  cachedRoot = process.cwd();
  return cachedRoot;
}

/** Folder holding generated Drizzle migrations. */
export function migrationsDir(): string {
  return join(packageRoot(), 'drizzle');
}

/** The curated seed list shipped with the package. */
export function seedJsonPath(): string {
  return join(packageRoot(), 'src', 'data', 'seed.json');
}

/** User-level weight-override config (§4): `~/.config/lurq/weights.json`. */
export function userWeightsPath(): string {
  const base = process.env.XDG_CONFIG_HOME || join(homedir(), '.config');
  return join(base, 'lurq', 'weights.json');
}

/** Project-local weight-override config (§4): `.lurq/weights.json` in the cwd.
 *  Takes precedence over the user-level file when present. */
export function projectWeightsPath(): string {
  return join(process.cwd(), '.lurq', 'weights.json');
}
