/**
 * Global test setup. Isolate both on-disk state a test could otherwise clobber:
 * the HTTP cache (~/.cache/lurq) and the user's stored credentials (~/.lurq),
 * which now hold a live API key.
 */
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.LURQ_CACHE_DIR = mkdtempSync(join(tmpdir(), 'lurq-test-cache-'));
process.env.LURQ_HOME = mkdtempSync(join(tmpdir(), 'lurq-test-home-'));
