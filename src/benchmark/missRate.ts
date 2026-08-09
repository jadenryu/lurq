/**
 * M0 — the agent-specific miss rate (§12), controlled arm.
 *
 * The question: how often does model-authored code reference symbols that are
 * ABSENT from the version actually pinned? §1.6 calls this "the unmeasured row",
 * and it is the number that decides whether lurq is insurance or infrastructure.
 *
 * Method: pin a version IN THE PROMPT, ask for code, scan what comes back for
 * symbols used from that package, and check each against the tier-A surface at
 * that exact version. A referenced symbol the version does not export is a miss —
 * the import throws, or the call is undefined.
 *
 * KNOWN LIMITS, which must travel with any number this produces:
 *   1. No human baseline. M0's kill condition is "not materially above human
 *      baseline", and generated code has no such arm. This measures magnitude,
 *      it cannot pass or fail the gate.
 *   2. Models in a harness, not agents in a loop. A real agent might run `tsc`
 *      and self-correct — though GitChameleon puts the ceiling on that at ~58.5%
 *      even when handed the error trace.
 *   3. Miss ≠ certain failure. A symbol missing from tier A is missing at
 *      runtime, but the code may never execute that path.
 */
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { getConfig } from '../core/config';
import { fetchAndExtract } from '../surface/fetch';
import { SURFACE_CLAIM_KINDS, isRootSpecifier, scanReferences } from '../surface/references';
import { runtimeSymbols } from '../surface/types';

export interface MissRateCase {
  id: string;
  /** The package the generated code must use. Single-package form. */
  package?: string;
  /** The EXACT version pinned in the prompt. */
  version?: string;
  /**
   * Multi-package form — a realistic stack. Production code is written against
   * many packages at once, and that is what changes the number that matters:
   * the per-symbol miss rate is a property of the model, but the odds that a
   * PROJECT contains at least one break compound with every package it touches.
   */
  packages?: { name: string; version: string }[];
  /** What the code should do. */
  task: string;
}

/** Normalize either form to a package list. */
function casePackages(c: MissRateCase): { name: string; version: string }[] {
  if (c.packages?.length) return c.packages;
  if (c.package) return [{ name: c.package, version: c.version ?? 'latest' }];
  return [];
}

export interface CaseResult {
  id: string;
  package: string;
  version: string;
  model: string;
  /** Per-package breakdown; length 1 for single-package cases. */
  perPackage?: { package: string; version: string; referenced: string[]; missing: string[] }[];
  referenced: string[];
  missing: string[];
  missRate: number | null;
  /** Set when no verdict may be drawn. Never counted as a hit OR a miss. */
  unverifiable?: string;
  code?: string;
}

export interface MissRateReport {
  model: string;
  /** Samples drawn per case. >1 is required for the number to mean anything. */
  samples: number;
  cases: number;
  scored: number;
  unverifiable: number;
  totalReferenced: number;
  totalMissing: number;
  /** Pooled over symbols, not a mean of per-case rates. */
  symbolMissRate: number | null;
  /**
   * Share of cases with at least one missing symbol — the "would break" rate.
   *
   * THIS is the number that rises with stack size, not `symbolMissRate`. The
   * per-symbol rate is a property of the model and does not change when a
   * project adds dependencies; what changes is exposure. If each referenced
   * symbol is wrong with probability p and a project references N of them,
   * P(at least one break) = 1 - (1-p)^N, which saturates fast.
   */
  caseMissRate: number | null;
  /** Mean module-surface symbols referenced per scored sample. The N above. */
  symbolsPerCase: number | null;
  /** 1-(1-p)^N at the measured p and N — the compounded project-level risk. */
  projectedBreakRate: number | null;
  results: CaseResult[];
}

const PROMPT = (c: MissRateCase) => {
  const pkgs = casePackages(c);
  const list = pkgs.map((p) => `  - ${p.name}@${p.version}`).join('\n');
  return `Write a single TypeScript module that does the following:

${c.task}

Requirements:
- Use these npm packages at these EXACT versions. They are already installed:
${list}
- Import only from those packages and Node built-ins.
- Use each listed package at least once.
- Output ONLY the TypeScript source. No markdown fences, no commentary.`;
};

/** Provider inferred from the model id, matching the existing participants. */
export type Provider = 'openai' | 'anthropic' | 'gemini';

function providerOf(model: string): Provider {
  if (model.startsWith('claude-')) return 'anthropic';
  if (model.startsWith('gemini-')) return 'gemini';
  return 'openai';
}

/** Strip markdown fences models add despite instructions. */
function unfence(text: string): string {
  return text.replace(/^```[a-z]*\n?/gim, '').replace(/```$/gm, '').trim();
}

/**
 * One chat call per provider, over raw HTTP.
 *
 * Deliberately matches the existing participants (openai.ts / anthropic.ts /
 * gemini.ts) rather than pulling in a vendor SDK: this package publishes to npm,
 * all three arms of the comparison should differ only in the model, and three
 * SDKs for three ~20-line calls is a dependency cost with no payoff here.
 */
/**
 * Enough room for the module AND whatever the model thinks first.
 *
 * This was 4096 on the Anthropic arm and unset on the other two. Thinking is on
 * by default on current Claude models and is billed out of the same ceiling, so
 * a measured run spent 3,560 of 4,096 tokens thinking and returned a file cut
 * off mid-line — `stop_reason: max_tokens`, one case in four unusable. Truncated
 * code is worse than no code here: it references fewer symbols than the model
 * intended, so a partial file that still parses drags the miss rate DOWN. The
 * number would have looked better for being broken.
 *
 * 8192 was the first attempt and proved marginal rather than wrong: uuid-9-v6
 * scored cleanly on one run and tripped the cap on the next, because thinking
 * length varies between identical requests. A ceiling that a case crosses only
 * sometimes turns the suite into a coin flip, so this is set well clear of the
 * observed draw rather than just above it. It costs nothing to raise — the
 * parameter is a limit, not a reservation, and only generated tokens are
 * billed.
 */
const MAX_OUTPUT_TOKENS = 16384;

/**
 * A generation that ran out of room, which is not an answer.
 *
 * Thrown rather than returned so it lands in scoreCase's existing catch and is
 * reported as `unverifiable` — the same treatment as a package whose surface
 * cannot be read. A case we could not measure has to be visibly absent from the
 * denominator, never silently counted as a model that got it right.
 */
class TruncatedError extends Error {
  constructor(model: string) {
    super(`${model} hit the output cap before finishing the module`);
    this.name = 'TruncatedError';
  }
}

async function generate(model: string, prompt: string): Promise<string> {
  const provider = providerOf(model);
  if (provider === 'anthropic') return generateAnthropic(model, prompt);
  if (provider === 'gemini') return generateGemini(model, prompt);
  return generateOpenAI(model, prompt);
}

async function generateOpenAI(model: string, prompt: string): Promise<string> {
  const config = getConfig();
  const key = config.SUMMARY_API_KEY || config.EMBEDDING_API_KEY;
  if (!key) throw new Error('OpenAI arm requires SUMMARY_API_KEY or EMBEDDING_API_KEY');

  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
    body: JSON.stringify({ model, messages: [{ role: 'user', content: prompt }], temperature: 1 }),
  });
  if (!res.ok) {
    throw new Error(`OpenAI API error ${res.status}: ${(await res.text().catch(() => '')).slice(0, 200)}`);
  }
  const body = (await res.json()) as {
    choices?: { message?: { content?: string }; finish_reason?: string }[];
  };
  if (body.choices?.[0]?.finish_reason === 'length') throw new TruncatedError(model);
  return unfence(body.choices?.[0]?.message?.content ?? '');
}

/**
 * Messages API. Note there is deliberately no `temperature`: it was removed on
 * Opus 4.7 and later and returns a 400 there, so sending it would break exactly
 * the models we most want to measure.
 */
async function generateAnthropic(model: string, prompt: string): Promise<string> {
  const key = process.env.CLAUDE_API_KEY;
  if (!key) throw new Error('Anthropic arm requires CLAUDE_API_KEY in .env');

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': key,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model,
      max_tokens: MAX_OUTPUT_TOKENS,
      messages: [{ role: 'user', content: prompt }],
    }),
  });
  if (!res.ok) {
    throw new Error(`Anthropic API error ${res.status}: ${(await res.text().catch(() => '')).slice(0, 200)}`);
  }
  const body = (await res.json()) as {
    content?: { type: string; text?: string }[];
    stop_reason?: string;
  };
  // A safety decline returns HTTP 200 with stop_reason 'refusal' and no text —
  // that is not a model failure to measure, so surface it as unverifiable.
  if (body.stop_reason === 'refusal') throw new Error('anthropic declined the request (refusal)');
  if (body.stop_reason === 'max_tokens') throw new TruncatedError(model);
  const text = body.content?.find((c) => c.type === 'text')?.text ?? '';
  return unfence(text);
}

async function generateGemini(model: string, prompt: string): Promise<string> {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error('Gemini arm requires GEMINI_API_KEY in .env');

  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] }),
    },
  );
  if (!res.ok) {
    throw new Error(`Gemini API error ${res.status}: ${(await res.text().catch(() => '')).slice(0, 200)}`);
  }
  const body = (await res.json()) as {
    candidates?: { content?: { parts?: { text?: string }[] }; finishReason?: string }[];
  };
  if (body.candidates?.[0]?.finishReason === 'MAX_TOKENS') throw new TruncatedError(model);
  return unfence(body.candidates?.[0]?.content?.parts?.[0]?.text ?? '');
}

export async function scoreCase(
  c: MissRateCase,
  model: string,
  opts: { code?: string; keepCode?: boolean } = {},
): Promise<CaseResult> {
  const pkgs = casePackages(c);
  const label = pkgs.map((x) => x.name).join('+');
  const base: CaseResult = {
    id: c.id,
    package: label,
    version: pkgs.map((x) => x.version).join(','),
    model,
    referenced: [],
    missing: [],
    missRate: null,
  };
  if (!pkgs.length) return { ...base, unverifiable: 'case names no packages' };

  let code: string;
  try {
    code = opts.code ?? (await generate(model, PROMPT(c)));
  } catch (err) {
    return { ...base, unverifiable: `generation failed: ${String(err).slice(0, 160)}` };
  }
  if (!code.trim()) return { ...base, unverifiable: 'model returned no code' };

  // Surfaces first: scoring against an absent surface would mark every
  // referenced symbol a miss — the §6.4.2 failure, one layer up. A package we
  // cannot read is skipped, not counted against the model.
  const surfaces = new Map<string, Set<string>>();
  const unreadable: string[] = [];
  for (const pkg of pkgs) {
    const fetched = await fetchAndExtract(pkg.name, pkg.version);
    if (!fetched || fetched.surface.undeclaredReason) {
      unreadable.push(pkg.name);
      continue;
    }
    surfaces.set(pkg.name, new Set(runtimeSymbols(fetched.surface).map((x) => x.path)));
  }
  if (!surfaces.size) {
    return {
      ...base,
      unverifiable: `no readable surface for ${unreadable.join(', ')}`,
      ...(opts.keepCode ? { code } : {}),
    };
  }

  const dir = await mkdtemp(join(tmpdir(), 'lurq-missrate-'));
  try {
    await writeFile(join(dir, 'generated.ts'), code);
    const allRefs = scanReferences(dir);

    const perPackage: NonNullable<CaseResult['perPackage']> = [];
    for (const pkg of pkgs) {
      const exported = surfaces.get(pkg.name);
      if (!exported) continue;
      const refs = allRefs.find((r) => r.package === pkg.name);
      if (!refs || refs.symbols.size === 0) continue;

      // Only score claims about the MODULE'S export surface. `chalk.bold` is a
      // property of the default export's value — correct usage tier A cannot
      // see, so counting it inflates the miss rate on working code. And when a
      // package exports only a bare value (module.exports = fn, e.g. `ms`),
      // even CJS member reads are properties of that value, not exports.
      const bareValue = exported.size <= 1 && exported.has('default');
      const referenced = [...refs.symbols.entries()]
        .filter(([sym, uses]) => {
          if (sym === 'default') return false;
          return uses.some(
            (u) =>
              SURFACE_CLAIM_KINDS.includes(u.via) &&
              // A subpath import has its own entry point and its own surface;
              // scoring it against the root reports every symbol missing.
              isRootSpecifier(u, pkg.name) &&
              !(bareValue && u.via === 'namespace'),
          );
        })
        .map(([sym]) => sym)
        .sort();
      if (!referenced.length) continue;
      perPackage.push({
        package: pkg.name,
        version: pkg.version,
        referenced,
        missing: referenced.filter((x) => !exported.has(x)),
      });
    }

    if (!perPackage.length) {
      return {
        ...base,
        unverifiable:
          'no module-surface claims, only default/member access, which tier A cannot verify',
        ...(opts.keepCode ? { code } : {}),
      };
    }

    const referenced = perPackage.flatMap((x) => x.referenced);
    const missing = perPackage.flatMap((x) => x.missing);
    return {
      ...base,
      perPackage,
      referenced,
      missing,
      missRate: missing.length / referenced.length,
      ...(opts.keepCode ? { code } : {}),
    };
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

/**
 * Run the suite, sampling each case `samples` times.
 *
 * Repeated sampling is not optional rigour — it is the fix for the defect that
 * made the first pilot uninterpretable. At temperature 1 each case is ONE draw
 * from a distribution, and two runs of the same 10 cases gave 30% then 23%.
 * A single-sample number is noise dressed as a measurement.
 */
export async function runMissRate(
  cases: MissRateCase[],
  model: string,
  opts: { keepCode?: boolean; samples?: number } = {},
): Promise<MissRateReport> {
  const samples = Math.max(1, opts.samples ?? 1);
  const results: CaseResult[] = [];
  for (const c of cases) {
    for (let i = 0; i < samples; i++) {
      const r = await scoreCase(c, model, opts);
      results.push(samples > 1 ? { ...r, id: `${c.id}#${i + 1}` } : r);
    }
  }

  const scored = results.filter((r) => r.missRate !== null);
  const totalReferenced = scored.reduce((a, r) => a + r.referenced.length, 0);
  const totalMissing = scored.reduce((a, r) => a + r.missing.length, 0);
  const p = totalReferenced ? totalMissing / totalReferenced : null;
  const symbolsPerCase = scored.length ? totalReferenced / scored.length : null;
  return {
    model,
    samples,
    cases: results.length,
    scored: scored.length,
    unverifiable: results.length - scored.length,
    totalReferenced,
    totalMissing,
    symbolMissRate: totalReferenced ? totalMissing / totalReferenced : null,
    caseMissRate: scored.length
      ? scored.filter((r) => r.missing.length > 0).length / scored.length
      : null,
    symbolsPerCase,
    projectedBreakRate:
      p !== null && symbolsPerCase ? 1 - Math.pow(1 - p, symbolsPerCase) : null,
    results,
  };
}
