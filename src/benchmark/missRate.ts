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

/** Minimal chat call; mirrors the existing OpenAI participant's shape. */
async function generate(model: string, prompt: string): Promise<string> {
  const config = getConfig();
  const key = config.SUMMARY_API_KEY || config.EMBEDDING_API_KEY;
  if (!key) throw new Error('miss-rate run requires SUMMARY_API_KEY or EMBEDDING_API_KEY');

  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
    body: JSON.stringify({ model, messages: [{ role: 'user', content: prompt }], temperature: 1 }),
  });
  if (!res.ok) {
    throw new Error(`OpenAI API error ${res.status}: ${(await res.text().catch(() => '')).slice(0, 200)}`);
  }
  const body = (await res.json()) as { choices?: { message?: { content?: string } }[] };
  const text = body.choices?.[0]?.message?.content ?? '';
  // Models add fences despite instructions; strip rather than fail the case.
  return text.replace(/^```[a-z]*\n?/gim, '').replace(/```$/gm, '').trim();
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

export async function runMissRate(
  cases: MissRateCase[],
  model: string,
  opts: { keepCode?: boolean } = {},
): Promise<MissRateReport> {
  const results: CaseResult[] = [];
  for (const c of cases) results.push(await scoreCase(c, model, opts));

  const scored = results.filter((r) => r.missRate !== null);
  const totalReferenced = scored.reduce((a, r) => a + r.referenced.length, 0);
  const totalMissing = scored.reduce((a, r) => a + r.missing.length, 0);
  return {
    model,
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
