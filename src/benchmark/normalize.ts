/**
 * Proposal normalization and requirement-level coverage evaluation.
 *
 * `normalizeProposal` validates names, dedupes, and resolves the final
 * `isRuntime` flag. Participants provide `scopeHint`; normalization owns the
 * final classification.
 *
 * `evaluateCoverage` counts covered required needs by matching `needId` —
 * it never credits coverage based on package name or count alone.
 */
import type {
  BenchmarkCase,
  CoverageResult,
  NormalizedProposal,
  ProposedSelection,
  NormalizedSelection,
  StackProposal,
} from './types';

// ── npm name validation ─────────────────────────────────────────────────────

/**
 * Returns true if `name` is a valid npm package name.
 *
 * Rules (simplified from validate-npm-package-name):
 *   - May be scoped (@scope/name) or unscoped
 *   - Must not start with `-` or `.`
 *   - No spaces or uppercase
 *   - Length 1–214
 */
const NPM_NAME_RE = /^(@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/;

export function isValidNpmName(name: string): boolean {
  if (!name || name.length > 214) return false;
  return NPM_NAME_RE.test(name);
}

// ── Dev-scope categories ────────────────────────────────────────────────────

const DEV_CATEGORIES = new Set(['build-tool', 'bundler', 'linting']);
const TYPES_PREFIX = '@types/';

/**
 * Determine whether a package is runtime or development tooling.
 *
 * Priority:
 *   1. `scopeHint === 'development'` → not runtime
 *   2. `category` in DEV_CATEGORIES → not runtime
 *   3. Name matches `@types/*` → not runtime
 *   4. Otherwise → runtime
 */
function resolveIsRuntime(sel: ProposedSelection): boolean {
  if (sel.scopeHint === 'development') return false;
  if (sel.category && DEV_CATEGORIES.has(sel.category)) return false;
  if (sel.package.startsWith(TYPES_PREFIX)) return false;
  return true;
}

// ── normalizeProposal ───────────────────────────────────────────────────────

export function normalizeProposal(proposal: StackProposal): NormalizedProposal {
  const duplicateNames: string[] = [];
  const invalidNames: string[] = [];
  const runtimePackages: NormalizedSelection[] = [];
  const developmentPackages: NormalizedSelection[] = [];

  const seenNames = new Set<string>();

  for (const sel of proposal.selections) {
    // 1. Name validation
    if (!isValidNpmName(sel.package)) {
      invalidNames.push(sel.package);
      continue;
    }

    // 2. Dedupe
    if (seenNames.has(sel.package)) {
      duplicateNames.push(sel.package);
      continue;
    }
    seenNames.add(sel.package);

    // 3. Resolve isRuntime — normalization always sets this, never trusts the
    //    participant's pre-set value.
    const isRuntime = resolveIsRuntime(sel);
    const normalized: NormalizedSelection = { ...sel, isRuntime };

    if (isRuntime) {
      runtimePackages.push(normalized);
    } else {
      developmentPackages.push(normalized);
    }
  }

  return { duplicateNames, invalidNames, runtimePackages, developmentPackages };
}

// ── evaluateCoverage ────────────────────────────────────────────────────────

/**
 * Requirement-level coverage: a need is covered iff at least one selection
 * has a matching `needId`. Package count is irrelevant.
 */
export function evaluateCoverage(
  benchCase: BenchmarkCase,
  proposal: StackProposal,
): CoverageResult {
  const coveredIds = new Set(proposal.selections.map((s) => s.needId));
  const requiredNeeds = benchCase.needs.filter((n) => n.required);
  const missing: string[] = [];

  for (const need of requiredNeeds) {
    if (!coveredIds.has(need.id)) {
      missing.push(need.id);
    }
  }

  return {
    kind: 'slot-fill',
    required: requiredNeeds.length,
    covered: requiredNeeds.length - missing.length,
    threshold: benchCase.acceptance.minimumCovered,
    missing,
  };
}
