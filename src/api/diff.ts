/**
 * Diff two OpenAPI surfaces and rule on the version.
 *
 * The package side of lurq answers "will this upgrade break my code". This is the
 * same question asked by the other party: will this change break the people
 * calling me. Nothing else in the ecosystem holds both halves, and the mechanics
 * are identical — reduce each side to the promises it makes, subtract, and
 * classify what disappeared.
 *
 * The classification is deliberately narrow. Only changes that break a caller who
 * did nothing wrong move the verdict; everything else is reported and ignored by
 * the ruling. A check that flags a new optional field as breaking gets switched
 * off within a week, and a switched-off check catches nothing.
 */
import semver from 'semver';
import type { ApiSurface, Operation } from './openapi';

export type ChangeKind =
  | 'operation-removed'
  | 'required-param-added'
  | 'param-now-required'
  | 'required-body-field-added'
  | 'response-removed'
  | 'operation-added'
  | 'optional-param-added'
  | 'response-added'
  | 'operation-deprecated';

/** Which changes break a caller that changed nothing. The verdict reads only these. */
const BREAKING: ReadonlySet<ChangeKind> = new Set([
  'operation-removed',
  'required-param-added',
  'param-now-required',
  'required-body-field-added',
  'response-removed',
]);

export interface ApiChange {
  kind: ChangeKind;
  /** The operation this is about: `POST /v1/charges`. */
  operation: string;
  /** The parameter, field or status code, when the change is about one. */
  detail?: string;
  breaking: boolean;
}

export interface ApiDiff {
  /** Changes that break existing callers. */
  breaking: ApiChange[];
  /** Additive and informational changes. Never moves the verdict. */
  other: ApiChange[];
  /** Set when no comparison could be made; the arrays are meaningless if present. */
  inconclusive?: string;
}

const change = (kind: ChangeKind, operation: string, detail?: string): ApiChange => ({
  kind,
  operation,
  ...(detail ? { detail } : {}),
  breaking: BREAKING.has(kind),
});

/** Set difference, `a` minus `b`. */
const missing = (a: string[], b: string[]): string[] => {
  const has = new Set(b);
  return a.filter((x) => !has.has(x));
};

function compareOperation(before: Operation, after: Operation): ApiChange[] {
  const out: ApiChange[] = [];

  // A required parameter that was not there before breaks every existing caller,
  // whether it is genuinely new or was optional yesterday. The two are reported
  // as different kinds because the fix differs — one is a new field to send, the
  // other is a field they may already be sending.
  for (const param of missing(after.requiredParams, before.requiredParams)) {
    out.push(
      change(
        before.optionalParams.includes(param) ? 'param-now-required' : 'required-param-added',
        after.id,
        param,
      ),
    );
  }
  for (const param of missing(after.optionalParams, before.optionalParams)) {
    out.push(change('optional-param-added', after.id, param));
  }
  for (const field of missing(after.requiredBodyFields, before.requiredBodyFields)) {
    out.push(change('required-body-field-added', after.id, field));
  }
  for (const code of missing(before.responseCodes, after.responseCodes)) {
    out.push(change('response-removed', after.id, code));
  }
  for (const code of missing(after.responseCodes, before.responseCodes)) {
    out.push(change('response-added', after.id, code));
  }
  // Deprecation is a promise to remove, not a removal. Reported so it is visible
  // in the same place, never counted as a break.
  if (after.deprecated && !before.deprecated) out.push(change('operation-deprecated', after.id));

  return out;
}

export function diffApiSurfaces(before: ApiSurface, after: ApiSurface): ApiDiff {
  // Never rule from a surface we could not read. An unreadable `before` compared
  // against a real `after` would report the entire API as newly added; the other
  // way round it reports the whole API as deleted. Both are measurement failures
  // wearing a verdict.
  if (before.unreadableReason) return { breaking: [], other: [], inconclusive: `previous revision: ${before.unreadableReason}` };
  if (after.unreadableReason) return { breaking: [], other: [], inconclusive: `current revision: ${after.unreadableReason}` };

  const changes: ApiChange[] = [];
  for (const [id, op] of before.operations) {
    const next = after.operations.get(id);
    if (!next) {
      changes.push(change('operation-removed', id));
      continue;
    }
    changes.push(...compareOperation(op, next));
  }
  for (const id of after.operations.keys()) {
    if (!before.operations.has(id)) changes.push(change('operation-added', id));
  }

  return {
    breaking: changes.filter((c) => c.breaking),
    other: changes.filter((c) => !c.breaking),
  };
}

export type ApiVerdict = 'ok' | 'breaking' | 'inconclusive';

export interface ApiCheck {
  title: string | null;
  fromVersion: string | null;
  toVersion: string | null;
  verdict: ApiVerdict;
  /**
   * Whether `info.version` was bumped enough for what changed.
   *
   * `null` when it cannot be judged — either version is missing, or they are not
   * both semver. Plenty of real APIs version by date (`2026-08-16`) or not at
   * all, and inventing a semver reading of those would be a confident wrong
   * answer about the one field teams actually argue over.
   */
  versionCovers: boolean | null;
  diff: ApiDiff;
}

export function checkApi(before: ApiSurface, after: ApiSurface): ApiCheck {
  const diff = diffApiSurfaces(before, after);
  const base = {
    title: after.title ?? before.title,
    fromVersion: before.version,
    toVersion: after.version,
    diff,
  };
  if (diff.inconclusive) {
    return { ...base, verdict: 'inconclusive', versionCovers: null };
  }

  const from = before.version && semver.valid(before.version);
  const to = after.version && semver.valid(after.version);
  const versionCovers =
    from && to
      ? diff.breaking.length > 0
        ? semver.major(to) > semver.major(from)
        : semver.gte(to, from)
      : null;

  return { ...base, verdict: diff.breaking.length > 0 ? 'breaking' : 'ok', versionCovers };
}

const LIST_CAP = 15;

const LABEL: Record<ChangeKind, string> = {
  'operation-removed': 'removed',
  'required-param-added': 'new required param',
  'param-now-required': 'now required',
  'required-body-field-added': 'new required body field',
  'response-removed': 'response removed',
  'operation-added': 'added',
  'optional-param-added': 'new optional param',
  'response-added': 'response added',
  'operation-deprecated': 'deprecated',
};

function renderChanges(changes: ApiChange[]): string[] {
  const shown = changes.slice(0, LIST_CAP);
  const lines = shown.map(
    (c) => `    · ${c.operation}${c.detail ? `  →  ${c.detail}` : ''}   ${LABEL[c.kind]}`,
  );
  if (changes.length > shown.length) lines.push(`    … ${changes.length - shown.length} more`);
  return lines;
}

export function formatApiCheck(check: ApiCheck, label = 'api check'): string {
  const out = [`lurq, ${label}${check.title ? ` — ${check.title}` : ''}`, ''];

  if (check.verdict === 'inconclusive') {
    out.push(`INCONCLUSIVE  ${check.diff.inconclusive}`, '', 'No verdict. This is not a pass.');
    return out.join('\n');
  }

  const versions =
    check.fromVersion && check.toVersion ? `  ${check.fromVersion} → ${check.toVersion}` : '';

  if (check.diff.breaking.length) {
    out.push(`BREAKING${versions}`, '');
    out.push(`  ${check.diff.breaking.length} change(s) that break existing callers:`);
    out.push(...renderChanges(check.diff.breaking));
  } else {
    out.push(`OK${versions}`, '', '  Nothing here breaks an existing caller.');
  }

  if (check.diff.other.length) {
    out.push('', `  ${check.diff.other.length} other change(s):`);
    out.push(...renderChanges(check.diff.other));
  }

  if (check.versionCovers === false) {
    out.push(
      '',
      check.diff.breaking.length
        ? `  info.version went ${check.fromVersion} → ${check.toVersion}. A breaking change needs a major.`
        : `  info.version went ${check.fromVersion} → ${check.toVersion}, which is not ahead.`,
    );
  } else if (check.versionCovers === null && (check.fromVersion || check.toVersion)) {
    // Say so rather than staying silent: silence about the version reads as
    // approval of it.
    out.push('', '  info.version is not semver on both sides, so the bump was not judged.');
  }

  return out.join('\n');
}
