/**
 * Validation for CI-reported upgrade runs.
 *
 * This is a trust boundary: the payload comes from a workflow running on a
 * machine we do not control, authenticated only by an API key. Everything is
 * parsed rather than trusted, unknown fields are dropped, and every string is
 * length-capped so a malformed (or hostile) post cannot write unbounded data.
 *
 * `ownerId` and `repoId` are NOT parsed here — the caller injects them from the
 * authenticated key. A payload that could name its own owner would let any key
 * write rows against any account.
 */
import {
  UPGRADE_RUN_STATUSES,
  UPGRADE_SEVERITIES,
  type UpgradeRunStatus,
  type UpgradeSeverity,
} from './types';

/** Package names, versions, and repo slugs are all short; paths can be longer. */
const MAX_NAME = 214; // npm's own package-name limit
const MAX_VERSION = 64;
const MAX_URL = 500;
const MAX_SYMBOLS = 200;
const MAX_FILES = 100;
const MAX_PATH = 400;

export interface ParsedUpgradeRun {
  repoFullName: string;
  packageName: string;
  fromVersion: string;
  toVersion: string;
  severity: UpgradeSeverity;
  status: UpgradeRunStatus;
  symbolsAffected: string[];
  callSites: number;
  callSiteFiles: string[] | null;
  filesChanged: number | null;
  testsPassed: boolean | null;
  prUrl: string | null;
  runUrl: string;
}

function str(value: unknown, max: number): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, max) : null;
}

function strList(value: unknown, maxItems: number, maxLen: number): string[] {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  for (const item of value) {
    const parsed = str(item, maxLen);
    if (parsed) out.push(parsed);
    if (out.length >= maxItems) break;
  }
  return out;
}

/** Non-negative integers only; anything else becomes null rather than NaN. */
function count(value: unknown): number | null {
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isInteger(n) && n >= 0 && n < 1_000_000 ? n : null;
}

/** Parse one reported run, or null when it is unusable. */
export function parseUpgradeRun(input: unknown): ParsedUpgradeRun | null {
  if (!input || typeof input !== 'object') return null;
  const raw = input as Record<string, unknown>;

  const repoFullName = str(raw.repoFullName, MAX_NAME);
  const packageName = str(raw.packageName, MAX_NAME);
  const fromVersion = str(raw.fromVersion, MAX_VERSION);
  const toVersion = str(raw.toVersion, MAX_VERSION);
  if (!repoFullName || !packageName || !fromVersion || !toVersion) return null;

  const severity = UPGRADE_SEVERITIES.find((s) => s === raw.severity);
  const status = UPGRADE_RUN_STATUSES.find((s) => s === raw.status);
  if (!severity || !status) return null;

  // Absent means "not shared", which is different from "no files" — keep null so
  // the dashboard can tell a repo that opted out from one with nothing to report.
  const files = raw.callSiteFiles === undefined ? null : strList(raw.callSiteFiles, MAX_FILES, MAX_PATH);

  return {
    repoFullName,
    packageName,
    fromVersion,
    toVersion,
    severity,
    status,
    symbolsAffected: strList(raw.symbolsAffected, MAX_SYMBOLS, MAX_NAME),
    callSites: count(raw.callSites) ?? 0,
    callSiteFiles: files,
    filesChanged: count(raw.filesChanged),
    testsPassed: typeof raw.testsPassed === 'boolean' ? raw.testsPassed : null,
    prUrl: str(raw.prUrl, MAX_URL),
    // Empty string, not null: it is part of the dedup key (see schema).
    runUrl: str(raw.runUrl, MAX_URL) ?? '',
  };
}

/** Parse a batch, dropping unusable entries and reporting how many were dropped. */
export function parseUpgradeRuns(
  input: unknown,
  max: number,
): { runs: ParsedUpgradeRun[]; rejected: number } {
  if (!Array.isArray(input)) return { runs: [], rejected: 0 };
  const runs: ParsedUpgradeRun[] = [];
  let rejected = 0;
  for (const item of input.slice(0, max)) {
    const parsed = parseUpgradeRun(item);
    if (parsed) runs.push(parsed);
    else rejected++;
  }
  return { runs, rejected };
}

/** Declared dependency ranges posted by the CLI for a plan. */
export function parseDepsInput(input: unknown): Record<string, string> {
  if (!input || typeof input !== 'object') return {};
  const out: Record<string, string> = {};
  for (const [name, range] of Object.entries(input as Record<string, unknown>)) {
    const key = str(name, MAX_NAME);
    const value = str(range, MAX_VERSION);
    if (key && value) out[key] = value;
    // A manifest with more entries than this is not a real project's direct
    // dependency list; stop rather than fan out unbounded index lookups.
    if (Object.keys(out).length >= 1000) break;
  }
  return out;
}
