/**
 * Global test setup. Isolate the HTTP cache to a throwaway temp dir so tests
 * can never read or write the real on-disk cache (~/.cache/lurq).
 */
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.LURQ_CACHE_DIR = mkdtempSync(join(tmpdir(), 'lurq-test-cache-'));
