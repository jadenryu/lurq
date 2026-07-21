/**
 * Shared helpers for model-with-Lurq agent loops.
 * Prevents "tool forever" runs that never emit a StackProposal.
 */
import type { StackProposal } from '../types';

/** Hard cap on model↔tool turns (includes the forced final text turn). */
export const WITH_LURQ_MAX_ITERATIONS = 12;

/** Injected on the last turn so the model must stop calling tools. */
export const FINALIZE_NUDGE =
  'Stop calling tools now. Based on the tool results so far, emit ONLY the final StackProposal JSON object (selections + unmatchedNeedIds). Fill every required need with a co-installable package when possible — do not leave needs unmatched just because the absolute newest major conflicts. No markdown, no explanation.';

export function isFinalAgentTurn(iteration: number, max = WITH_LURQ_MAX_ITERATIONS): boolean {
  return iteration >= max;
}

/**
 * Extract a JSON object from model text.
 *
 * Important: do NOT use a greedy `[\s\S]*``` strip — with optional `json` on the
 * fence, that matches the *closing* fence and leaves an empty string (Claude's
 * ```json ... ``` responses were failing with "Unexpected end of JSON input").
 */
export function extractJsonObject(raw: string): string {
  let text = raw.trim();

  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced) {
    text = fenced[1].trim();
  }

  const start = text.indexOf('{');
  if (start === -1) {
    throw new Error('No JSON object found in model response');
  }

  let balance = 0;
  let inString = false;
  let escape = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (escape) {
        escape = false;
      } else if (ch === '\\') {
        escape = true;
      } else if (ch === '"') {
        inString = false;
      }
      continue;
    }
    if (ch === '"') {
      inString = true;
      continue;
    }
    if (ch === '{') balance++;
    else if (ch === '}') {
      balance--;
      if (balance === 0) {
        return text.substring(start, i + 1);
      }
    }
  }

  throw new Error('Incomplete JSON object in model response (truncated or unbalanced)');
}

/** Strip markdown fences and parse a StackProposal. */
export function parseStackProposalJson(raw: string, source: string): StackProposal {
  const jsonStr = extractJsonObject(raw);
  const parsed = JSON.parse(jsonStr) as StackProposal;
  if (!Array.isArray(parsed.selections) || !Array.isArray(parsed.unmatchedNeedIds)) {
    throw new Error('Parsed JSON does not match StackProposal interface');
  }
  for (const sel of parsed.selections) {
    sel.source = source;
  }
  return parsed;
}
