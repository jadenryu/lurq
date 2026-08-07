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
import { SURFACE_CLAIM_KINDS, scanReferences } from '../surface/references';
import { runtimeSymbols } from '../surface/types';

export interface MissRateCase {
  id: string;
  /** The package the generated code must use. */
  package: string;
  /** The EXACT version pinned in the prompt. */
  version: string;
  /** What the code should do. */
  task: string;
}

export interface CaseResult {
  id: string;
  package: string;
  version: string;
  model: string;
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
  /** Share of cases with at least one missing symbol — the "would break" rate. */
  caseMissRate: number | null;
  results: CaseResult[];
}

const PROMPT = (c: MissRateCase) =>
  `Write a single TypeScript module that does the following:

${c.task}

Requirements:
- Use the npm package "${c.package}" at version ${c.version}. That exact version is already installed.
- Import only from "${c.package}" and Node built-ins.
- Output ONLY the TypeScript source. No markdown fences, no commentary.`;

/** Provider inferred from the model id, matching the existing participants. */
export type Provider = 'openai' | 'anthropic' | 'gemini';

export function providerOf(model: string): Provider {
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
  const body = (await res.json()) as { choices?: { message?: { content?: string } }[] };
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
      max_tokens: 4096,
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
    candidates?: { content?: { parts?: { text?: string }[] } }[];
  };
  return unfence(body.candidates?.[0]?.content?.parts?.[0]?.text ?? '');
}

export async function scoreCase(
  c: MissRateCase,
  model: string,
  opts: { code?: string; keepCode?: boolean } = {},
): Promise<CaseResult> {
  const base: CaseResult = {
    id: c.id,
    package: c.package,
    version: c.version,
    model,
    referenced: [],
    missing: [],
    missRate: null,
  };

  let code: string;
  try {
    code = opts.code ?? (await generate(model, PROMPT(c)));
  } catch (err) {
    return { ...base, unverifiable: `generation failed: ${String(err).slice(0, 160)}` };
  }
  if (!code.trim()) return { ...base, unverifiable: 'model returned no code' };

  // Surface first: if we cannot read the package at this version, the case
  // yields no verdict. Scoring against an absent surface would mark every
  // referenced symbol a miss — the §6.4.2 failure, one layer up.
  const fetched = await fetchAndExtract(c.package, c.version);
  if (!fetched || fetched.surface.undeclaredReason) {
    return {
      ...base,
      unverifiable: `no readable surface for ${c.package}@${c.version}` +
        (fetched?.surface.undeclaredReason ? `: ${fetched.surface.undeclaredReason}` : ''),
      ...(opts.keepCode ? { code } : {}),
    };
  }
  const exported = new Set(runtimeSymbols(fetched.surface).map((s) => s.path));

  const dir = await mkdtemp(join(tmpdir(), 'lurq-missrate-'));
  try {
    await writeFile(join(dir, 'generated.ts'), code);
    const refs = scanReferences(dir).find((r) => r.package === c.package);
    if (!refs || refs.symbols.size === 0) {
      return { ...base, unverifiable: 'generated code imports nothing from the target package', ...(opts.keepCode ? { code } : {}) };
    }

    // Only score claims about the MODULE'S export surface. `chalk.bold` is a
    // property of the default export's value — correct usage that tier A cannot
    // see, so counting it inflates the miss rate on working code. And when the
    // package exports only a bare value (module.exports = fn, e.g. `ms`), even
    // CJS member reads are properties of that value rather than exports.
    const surfaceIsBareValue = exported.size <= 1 && exported.has('default');
    const referenced = [...refs.symbols.entries()]
      .filter(([sym, uses]) => {
        if (sym === 'default') return false;
        return uses.some(
          (u) =>
            SURFACE_CLAIM_KINDS.includes(u.via) &&
            !(surfaceIsBareValue && u.via === 'namespace'),
        );
      })
      .map(([sym]) => sym)
      .sort();
    if (!referenced.length) {
      return {
        ...base,
        unverifiable:
          'no module-surface claims — only default/member access, which tier A cannot verify',
        ...(opts.keepCode ? { code } : {}),
      };
    }
    const missing = referenced.filter((s) => !exported.has(s));
    return {
      ...base,
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
  return {
    model,
    samples,
    cases: results.length,
    scored: scored.length,
    unverifiable: results.length - scored.length,
    totalReferenced,
    totalMissing,
    symbolMissRate: totalReferenced ? totalMissing / totalReferenced : null,
    caseMissRate: scored.length ? scored.filter((r) => r.missing.length > 0).length / scored.length : null,
    results,
  };
}
