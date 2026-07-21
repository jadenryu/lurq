import type { BenchmarkCase } from '../types';

export function formatPrompt(benchCase: BenchmarkCase): string {
  const needsText = benchCase.needs
    .map(n => `- ID: "${n.id}"\n  Requirement: ${n.need}\n  Required: ${n.required}`)
    .join('\n\n');

  const constraints = benchCase.acceptance.constraints;
  const constraintsText =
    constraints.length > 0
      ? constraints.map((c, i) => `${i + 1}. ${c}`).join('\n')
      : '1. Prefer maintained, non-deprecated packages compatible with the stated runtime.';

  return `You are an expert full-stack TypeScript engineer architecting a new project.
You must select the best npm packages to satisfy the following project requirements.

Project Title: ${benchCase.title}
Topology: ${benchCase.topology}

Project Description:
${benchCase.document}

Requirements:
${needsText}

Hard acceptance constraints (must satisfy all):
${constraintsText}

Your task is to select exactly one npm package for each requirement ID above. 
If a requirement cannot be fulfilled by a single package, pick the most central one. 
If you cannot fulfill a requirement, add its ID to the unmatchedNeedIds array.

Output EXACTLY a JSON object conforming to this TypeScript interface:

interface ProposedSelection {
  needId: string;
  package: string;
  requestedVersion: string | null;
  scopeHint: 'runtime' | 'development' | 'unknown';
  category: string | null;
  lurqHealthScore: null;
  lurqConfidence: null;
  lurqSwappedFrom: null;
  source: string;
}

interface StackProposal {
  selections: ProposedSelection[];
  unmatchedNeedIds: string[];
}

Constraints:
1. "source" must be exactly "unaided-model".
2. "lurqHealthScore", "lurqConfidence", and "lurqSwappedFrom" must be null.
3. You must output raw JSON only, with no markdown code blocks, no backticks, and no explanation.
4. Selected packages must satisfy every hard acceptance constraint above.`;
}
