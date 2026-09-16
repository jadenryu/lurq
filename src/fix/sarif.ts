/**
 * Findings as SARIF 2.1.0.
 *
 * The cheapest possible answer to "where do these live once lurq has found
 * them?" is: somewhere that already has a board, dedup, assignment and a
 * close-when-fixed lifecycle. GitHub code scanning ingests SARIF and gives all
 * of that for free, so lurq's job is to file and close the items rather than to
 * grow a project-management UI of its own.
 *
 * Two decisions worth stating, because both are easy to get backwards:
 *
 *   - `ruleId` is the finding's CLASS (`renamed-export`), not its full code
 *     (`renamed-export:cookie:parse`). SARIF rules describe kinds of problem; a
 *     rule per package-and-symbol would put thousands of one-instance rules in
 *     the tool descriptor and make the Security tab unreadable.
 *   - the full code goes in `partialFingerprints`, which is what GitHub uses to
 *     recognise an alert across runs. Without it, every reformat that moves a
 *     line closes the old alert and opens a new one, and the history is lost.
 *
 * Deterministic findings also carry SARIF `fixes`, so the same proven rewrite
 * `lurq fix --apply` would make is renderable as a suggested change by anything
 * that reads the format.
 */
import { positionAt } from './diff';
import { deterministic, type Edit, type Finding, type FixSeverity } from './types';

/** SARIF's three levels, from ours. `info` is a note, not a warning. */
const LEVEL: Record<FixSeverity, 'error' | 'warning' | 'note'> = {
  blocking: 'error',
  warning: 'warning',
  info: 'note',
};

/** What each class of finding means, for the tool descriptor. */
const RULE_TEXT: Record<string, string> = {
  'renamed-export':
    'An export this code imports was renamed by the package itself, which proves the replacement.',
  'removed-export':
    'An export this code imports no longer exists, and the package does not say what replaced it.',
};

/** `renamed-export:cookie:parse` → `renamed-export`. */
export const ruleClassOf = (code: string): string => code.split(':')[0] || code;

export interface SarifOptions {
  /** Reported as the tool version, so a run is attributable to a release. */
  version: string;
  /** File text, for regions. Return null when the file cannot be read. */
  read: (file: string) => string | null;
}

interface Region {
  startLine: number;
  startColumn: number;
  endLine: number;
  endColumn: number;
}

const regionOf = (text: string, edit: Edit): Region => {
  const start = positionAt(text, edit.start);
  const end = positionAt(text, edit.end);
  return { startLine: start.line, startColumn: start.column, endLine: end.line, endColumn: end.column };
};

/** Which files a finding concerns, and the edits in each. */
function filesOf(f: Finding): { file: string; edits: Edit[] }[] {
  const byFile = new Map<string, Edit[]>();
  for (const e of f.fix?.edits ?? []) {
    const list = byFile.get(e.file);
    if (list) list.push(e);
    else byFile.set(e.file, [e]);
  }
  if (byFile.size > 0) return [...byFile].map(([file, edits]) => ({ file, edits }));

  // A brief names the files an agent may touch; a bare finding names one file.
  const named = f.fix?.task?.files ?? (f.file ? [f.file] : []);
  return [...new Set(named)].map((file) => ({ file, edits: [] }));
}

export function toSarif(findings: Finding[], opts: SarifOptions): object {
  const results: object[] = [];
  const seenRules = new Set<string>();

  for (const f of findings) {
    seenRules.add(ruleClassOf(f.code));
    const places = filesOf(f);

    // A finding with no file at all is still worth reporting: SARIF allows a
    // result with no location, and dropping it would hide a real problem.
    if (places.length === 0) {
      results.push({
        ruleId: ruleClassOf(f.code),
        level: LEVEL[f.severity],
        message: { text: f.detail },
        partialFingerprints: { lurqCode: f.code },
        properties: { fixable: deterministic(f), ...(f.evidence ? { evidence: f.evidence } : {}) },
      });
      continue;
    }

    for (const { file, edits } of places) {
      const text = edits.length > 0 ? opts.read(file) : null;
      const region = text !== null && edits[0] ? regionOf(text, edits[0]) : null;

      results.push({
        ruleId: ruleClassOf(f.code),
        level: LEVEL[f.severity],
        message: { text: f.detail },
        locations: [
          {
            physicalLocation: {
              artifactLocation: { uri: file, uriBaseId: '%SRCROOT%' },
              ...(region ? { region } : {}),
            },
          },
        ],
        // Same finding, same file, across runs — even if the line moved.
        partialFingerprints: { lurqCode: `${f.code}@${file}` },
        properties: {
          fixable: deterministic(f),
          ...(f.evidence ? { evidence: f.evidence } : {}),
          ...(f.fix?.task ? { agentInstruction: f.fix.task.instruction } : {}),
        },
        ...(text !== null && edits.length > 0
          ? {
              fixes: [
                {
                  description: { text: f.fix!.summary },
                  artifactChanges: [
                    {
                      artifactLocation: { uri: file, uriBaseId: '%SRCROOT%' },
                      replacements: edits.map((e) => ({
                        deletedRegion: regionOf(text, e),
                        insertedContent: { text: e.text },
                      })),
                    },
                  ],
                },
              ],
            }
          : {}),
      });
    }
  }

  return {
    $schema: 'https://json.schemastore.org/sarif-2.1.0.json',
    version: '2.1.0',
    runs: [
      {
        tool: {
          driver: {
            name: 'lurq',
            informationUri: 'https://lurq.run',
            version: opts.version,
            rules: [...seenRules].sort().map((id) => ({
              id,
              name: id,
              shortDescription: { text: RULE_TEXT[id] ?? `lurq finding: ${id}` },
            })),
          },
        },
        results,
      },
    ],
  };
}
