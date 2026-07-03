/**
 * `plan` tool — turn a described program into an evidence-scored build plan.
 *
 * This is NOT the "architecture oracle" non-goal (master-spec §4): it does not
 * invent an architecture from a one-line prompt. It takes a program the caller
 * has *already described in detail* (a spec/README) — or a pre-decomposed list
 * of needs — and runs lurq's normal `recommend` engine slot-by-slot, returning
 * real packages from the index with their scores. lurq still "supplies building
 * blocks slot-by-slot; the agent assembles the architecture" (§1.3). The rich
 * input is what removes the guesswork the spec warned against; the §20 roadmap
 * item ("architecture recommendation … once data can ground it") is honored
 * because every recommendation is grounded in the scored index.
 *
 * Decomposition (document → needs) follows Option C:
 *  - a caller-supplied `needs[]` is used as-is (the agent already read the doc — the
 *    fast, zero-LLM path, and the cleanest companion-model division of labor); else
 *  - a raw `document` is decomposed server-side: by the summary LLM when a key is
 *    configured, otherwise by a transparent heading/keyword heuristic. The heuristic
 *    is honest-but-coarse, and the response note says so.
 */
import { createHash } from 'node:crypto';
import { inArray } from 'drizzle-orm';
import { getConfig } from '../core/config';
import { httpRequest } from '../core/http';
import { checkCompat } from '../compat/check';
import { assembleMembers } from '../compat/members';
import { optimizeStack } from '../compat/optimize';
import type { CompatMember } from '../compat/peerCompat';
import { getCompatEdges } from '../db/compat';
import { logger } from '../core/logger';
import {
  isCategory,
  type Candidate,
  type Category,
  type CompatConflict,
  type CompatOutput,
} from '../core/types';
import type { Database } from '../db/client';
import { packages } from '../db/schema';
import { inferCategory } from '../search/categoryInference';
import { recommend } from '../search/recommend';
import { getOrFetchPackage } from '../pipeline/single';
import type { PackageRow } from '../db/schema';
import { buildMermaid, layerFor } from './diagram';
import { latestDataAsOf } from './handlers';

/** A pinned package the user chose, resolved to a fixed single-candidate slot. */
function packageToCandidate(row: PackageRow): Candidate {
  return {
    name: row.name,
    category: row.category,
    healthScore: row.healthScore ?? 0,
    qualityScore: row.qualityScore,
    confidence: row.confidence ?? 'unproven',
    why: 'pinned by you',
    latestVersion: row.latestVersion,
    weeklyDownloads: row.weeklyDownloads,
    lastReleaseAt: row.lastReleaseAt ? row.lastReleaseAt.toISOString() : null,
    repoUrl: row.repoUrl,
  };
}

/** Resolve user-pinned packages into fixed slots (one candidate, no alternatives)
 *  so the optimizer routes the recommended slots around them. Unresolvable pins
 *  (not on npm) are returned so the caller can report them. */
export async function resolvePins(
  db: Database,
  using: string[] | undefined,
  recommendedNames: Set<string>,
): Promise<{ slots: PlanSlot[]; unresolved: string[] }> {
  const slots: PlanSlot[] = [];
  const unresolved: string[] = [];
  // Dedupe, and skip a pin the recommender already picked (avoid double slots).
  for (const name of new Set(using ?? [])) {
    if (recommendedNames.has(name)) continue;
    const { row } = await getOrFetchPackage(db, name);
    if (!row) {
      unresolved.push(name);
      continue;
    }
    slots.push({
      need: `using ${name}`,
      category: row.category,
      layer: layerFor({ label: name, category: row.category }),
      recommended: packageToCandidate(row),
      alternatives: [], // fixed: the user chose this, so it never gets swapped
      note: 'pinned by you',
    });
  }
  return { slots, unresolved };
}

/** A single component/slot to recommend a package for. */
export interface PlanNeed {
  need: string;
  category?: Category;
}

export interface PlanInput {
  /** Detailed description of the program (spec/README). lurq decomposes it. */
  document?: string;
  /** Pre-decomposed needs (e.g. the calling agent already read the doc). */
  needs?: PlanNeed[];
  /** Packages the user has already chosen. Pinned as fixed slots; lurq
   *  recommends only the remaining needs and plans the stack around these. */
  using?: string[];
  /** Ranking bias. 'speed' prefers the lightest-bundle option among the top
   *  candidates for a slot; 'balanced' (default) uses the normal ranking. */
  optimize?: 'speed' | 'balanced';
}

export interface PlanSlot {
  need: string;
  category: Category | null;
  layer: string;
  recommended: Candidate | null;
  alternatives: Candidate[];
  note?: string;
  /** Picked packages this slot's pick still conflicts with, if it couldn't be
   *  auto-resolved with the available alternatives (residual conflict). */
  conflictsWith?: string[];
  /** If plan swapped this slot's pick to keep the stack compatible, the name of
   *  the original (higher-ranked) pick it replaced. */
  swappedFrom?: string;
}

export interface PlanOutput {
  dataAsOf: string;
  optimize: 'speed' | 'balanced';
  /** Where the slots came from: caller-supplied needs, lurq's LLM, or the heuristic. */
  source: 'needs' | 'llm' | 'heuristic';
  /** The framework/meta-framework that anchored the plan, if one was found. Every
   *  other slot was recommended in this ecosystem's context. null = no framework
   *  in the spec, so slots were recommended independently. */
  framework: string | null;
  slots: PlanSlot[];
  /** Needs for which no tracked package matched. */
  unmatched: string[];
  mermaid: string;
  note: string;
  /** Whole-stack compatibility of the picked packages (peer-deps/engines +
   *  recorded sandbox conflicts). Evidence-backed, with name@version of each
   *  member; null if the check couldn't run. */
  compatibility: CompatOutput | null;
}

/** Candidates to surface per slot: the pick plus a couple of alternatives. */
const PER_SLOT = 3;
/** Cap on slots so a huge document can't fan out into hundreds of queries. */
const MAX_SLOTS = 24;

export async function handlePlan(db: Database, input: PlanInput): Promise<PlanOutput | { note: string }> {
  const optimize = input.optimize ?? 'balanced';

  const decomposed = input.needs?.length
    ? { needs: dedupeNeeds(input.needs), source: 'needs' as const }
    : input.document?.trim()
      ? await decompose(input.document)
      : null;

  const hasPins = Boolean(input.using?.length);
  if ((!decomposed || decomposed.needs.length === 0) && !hasPins) {
    return {
      note: 'Provide a `document` (a detailed description of your program), a `needs` array, or a `using` list of packages you have already chosen. lurq recommends evidence-scored packages per component — it does not invent an architecture from a bare prompt.',
    };
  }

  const needs = (decomposed?.needs ?? []).slice(0, MAX_SLOTS);
  const source = decomposed?.source ?? 'needs';

  const safeRecommend = (need: string, category: Category | undefined) =>
    recommend(db, { need, category, limit: PER_SLOT }).catch((err) => {
      logger.warn(`plan: recommend failed for "${need}": ${(err as Error).message}`);
      return [] as Candidate[];
    });
  // Effective category per slot — the decomposition hint, else inferred from the
  // ORIGINAL need text (before any framework context is appended, so the word we
  // inject below can never misclassify the slot).
  const effCat = (n: PlanNeed): Category | undefined => n.category ?? inferCategory(n.need) ?? undefined;

  // Detect the framework family from the WHOLE spec (document + need texts), so the
  // plan stays coherent even when decomposition doesn't emit a framework slot.
  // This drives the coherence re-rank below.
  const anchorFamily = familyOf(`${input.document ?? ''} ${needs.map((n) => n.need).join(' ')}`);

  // Phase 1: if a framework/meta-framework component exists, resolve it first to
  // name the concrete package (a meta-framework like Next wins over a bare
  // framework); otherwise the detected family is the context word.
  const metaIdx = needs.findIndex((n) => effCat(n) === 'meta-framework');
  const anchorIdx = metaIdx >= 0 ? metaIdx : needs.findIndex((n) => effCat(n) === 'framework');

  const recs: Candidate[][] = new Array(needs.length);
  let framework: string | null = anchorFamily;
  if (anchorIdx >= 0) {
    recs[anchorIdx] = await safeRecommend(needs[anchorIdx]!.need, effCat(needs[anchorIdx]!));
    framework = recs[anchorIdx]![0]?.name ?? anchorFamily;
  }

  // Phase 2: recommend the remaining slots concurrently, weaving the chosen
  // framework into each query so sibling libraries stay in-ecosystem. The slot's
  // category is passed explicitly, so the injected framework word only sways
  // relevance — never the category filter. Framework-agnostic slots (e.g.
  // date/time) are unaffected since their candidates don't mention the framework.
  const [, dataAsOf] = await Promise.all([
    Promise.all(
      needs.map(async (n, i) => {
        if (i === anchorIdx) return;
        const need = framework ? `${n.need} (for a ${framework} app)` : n.need;
        recs[i] = await safeRecommend(need, effCat(n));
      }),
    ),
    latestDataAsOf(db),
  ]);

  // Re-rank each slot's candidates: keep the architecture coherent (cross-
  // framework bindings last), then — for 'speed' — prefer the lightest bundle,
  // otherwise preserve recommend's relevance order. One batched lookup keeps
  // `recommend` itself untouched.
  const bundleByName = optimize === 'speed' ? await bundleSizes(db, recs.flat()) : new Map<string, number>();

  const recSlots: PlanSlot[] = needs.map((n, i) => {
    const candidates = orderCandidates(recs[i]!, anchorFamily, optimize, bundleByName);
    const recommended = candidates[0] ?? null;
    const category = n.category ?? recommended?.category ?? inferCategory(n.need);
    return {
      need: n.need,
      category,
      layer: layerFor({ label: recommended?.name ?? n.need, category }),
      recommended,
      alternatives: candidates.slice(1),
      note: recommended ? undefined : 'no tracked package matched this need yet',
    };
  });

  // Pin the user's chosen packages as fixed slots, then plan the rest around
  // them. Pins lead so they anchor the stack; the optimizer can only move the
  // recommended slots, so it routes them to stay compatible with the pins.
  const recommendedNames = new Set(
    recSlots.map((s) => s.recommended?.name).filter((n): n is string => Boolean(n)),
  );
  const { slots: pinnedSlots, unresolved: unresolvedPins } = await resolvePins(
    db,
    input.using,
    recommendedNames,
  );
  const slots = [...pinnedSlots, ...recSlots];

  // Auto-resolve compatibility: actually make the picked stack coherent by
  // swapping a conflicting slot's pick for an alternative that resolves it.
  // Runs before the diagram/output so everything below reflects the final stack.
  const compatibility = await resolveCompat(db, slots);

  const unmatched = [
    ...slots.filter((s) => !s.recommended).map((s) => s.need),
    ...unresolvedPins.map((n) => `${n} (pinned, but not found on npm)`),
  ];
  const mermaid = buildMermaid(
    slots
      .filter((s) => s.recommended)
      .map((s) => ({ label: s.recommended!.name, category: s.category })),
  );

  return {
    dataAsOf,
    optimize,
    source,
    framework,
    slots,
    unmatched,
    mermaid,
    note: planNote(source, unmatched.length, optimize, framework),
    compatibility,
  };
}

/** Map each slot (by need) to the other picked packages its pick conflicts with. */
export function flagSlotConflicts(
  picks: { need: string; name: string | null }[],
  conflicts: CompatConflict[],
): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const c of conflicts) {
    for (const p of picks) {
      if (p.name && c.packages.includes(p.name)) {
        const others = c.packages.filter((n) => n !== p.name);
        out.set(p.need, [...new Set([...(out.get(p.need) ?? []), ...others])]);
      }
    }
  }
  return out;
}

const NO_META = (c: Candidate): CompatMember => ({
  name: c.name,
  version: c.latestVersion,
  peerDependencies: null,
  peerDependenciesMeta: null,
  engines: null,
});

/**
 * Make the picked stack compatible by *globally optimising* the slot choices:
 * pre-load every candidate's metadata + cached sandbox edges once, then run a
 * branch-and-bound that picks the highest-quality (lowest rank-regret) compatible
 * combination. The chosen alternative is promoted to `recommended` (original
 * demoted, recorded via `swappedFrom`); residual conflicts are flagged per slot.
 * The search is pure/in-memory; only the final report re-reads the DB.
 * Best-effort — never throws.
 */
async function resolveCompat(db: Database, slots: PlanSlot[]): Promise<CompatOutput | null> {
  const eligible = slots.filter((s) => s.recommended);
  if (eligible.length < 2) return null;

  try {
    // One pass: metadata for every candidate across all slots → pure search.
    const allNames = [
      ...new Set(eligible.flatMap((s) => [s.recommended!, ...s.alternatives].map((c) => c.name))),
    ];
    const [{ members }, edges] = await Promise.all([
      assembleMembers(db, allNames),
      getCompatEdges(db, allNames),
    ]);
    const metaByName = new Map(members.map((m) => [m.name, m]));
    const sandboxConflicts = new Set(
      edges.filter((e) => e.status === 'conflict').map((e) => `${e.packageA}|${e.packageB}`),
    );
    const slotCandidates = eligible.map((s) =>
      [s.recommended!, ...s.alternatives].map((c) => metaByName.get(c.name) ?? NO_META(c)),
    );

    const { selection } = optimizeStack(slotCandidates, sandboxConflicts);

    // Apply the optimal selection: promote the chosen candidate per slot.
    eligible.forEach((s, i) => {
      const idx = selection[i] ?? 0;
      if (idx <= 0) return;
      const all = [s.recommended!, ...s.alternatives];
      const chosen = all[idx];
      if (!chosen) return;
      s.recommended = chosen;
      s.alternatives = all.filter((c) => c.name !== chosen.name);
      s.swappedFrom = all[0]!.name;
    });
  } catch (err) {
    logger.warn(`plan: compat optimization failed: ${String(err)}`);
  }

  // Authoritative report on the final picks, and flag any residual conflicts.
  const compat = await checkCompat(
    db,
    eligible.map((s) => s.recommended!.name),
  ).catch(() => null);
  if (compat) {
    const flags = flagSlotConflicts(
      slots.map((s) => ({ need: s.need, name: s.recommended?.name ?? null })),
      compat.conflicts,
    );
    for (const s of slots) {
      const cw = flags.get(s.need);
      s.conflictsWith = cw?.length ? cw : undefined;
    }
  }
  return compat;
}

function planNote(
  source: PlanOutput['source'],
  unmatched: number,
  optimize: string,
  framework: string | null,
): string {
  const base =
    source === 'heuristic'
      ? 'Components were extracted from your document with a keyword heuristic (no summary LLM configured) — coarse; pass a `needs` array or set SUMMARY_API_KEY for sharper decomposition.'
      : source === 'llm'
        ? 'Components were extracted from your document by the summary model.'
        : 'Components taken from the supplied needs.';
  const grounding =
    ' Each package is recommended from lurq’s scored index — a labeled, evidence-backed starting point, not a validated architecture.';
  const ctx = framework
    ? ` Anchored to the ${framework} ecosystem so sibling libraries stay coherent across the stack.`
    : '';
  const tail = unmatched ? ` ${unmatched} need(s) had no tracked match (listed in \`unmatched\`).` : '';
  const opt = optimize === 'speed' ? ' Ranking favored the lightest-bundle option per slot.' : '';
  return base + grounding + ctx + opt + tail;
}

/** Merge duplicate needs (same text), keeping the first category hint seen. */
function dedupeNeeds(needs: PlanNeed[]): PlanNeed[] {
  const seen = new Map<string, PlanNeed>();
  for (const n of needs) {
    const key = n.need.trim().toLowerCase();
    if (!key) continue;
    if (!seen.has(key)) seen.set(key, { need: n.need.trim(), category: n.category });
  }
  return [...seen.values()];
}

/** The framework "family" a package name belongs to (by naming convention), or
 *  null if framework-agnostic. Lets the plan stay in one ecosystem — never
 *  surface a different framework's binding (e.g. vue-router in a React app). */
const FAMILY_TOKENS: { family: string; re: RegExp }[] = [
  { family: 'react', re: /\breact\b|preact/ },
  { family: 'vue', re: /\bvue\b|nuxt/ },
  { family: 'angular', re: /angular/ },
  { family: 'svelte', re: /svelte/ },
  { family: 'solid', re: /\bsolid(-?js)?\b/ },
];

export function familyOf(name: string): string | null {
  const n = name.toLowerCase();
  for (const f of FAMILY_TOKENS) if (f.re.test(n)) return f.family;
  return null;
}

/**
 * Order a slot's candidates: in-ecosystem first and cross-framework bindings
 * last (when an anchor framework was found), then — for 'speed' — lightest
 * bundle, otherwise preserving recommend's relevance ranking (V8's sort is
 * stable, so equal-key candidates keep their incoming order).
 */
export function orderCandidates(
  cands: Candidate[],
  anchorFamily: string | null,
  optimize: 'speed' | 'balanced',
  bundleByName: Map<string, number>,
): Candidate[] {
  // +1 same ecosystem, −1 a competing framework, 0 framework-agnostic.
  const coherence = (c: Candidate): number => {
    const fam = familyOf(c.name);
    if (!fam) return 0;
    return fam === anchorFamily ? 1 : -1;
  };
  return [...cands].sort((a, b) => {
    if (anchorFamily) {
      const d = coherence(b) - coherence(a);
      if (d) return d;
    }
    if (optimize === 'speed') {
      return (bundleByName.get(a.name) ?? Infinity) - (bundleByName.get(b.name) ?? Infinity);
    }
    return 0;
  });
}

/** Batched bundle-size lookup for the 'speed' re-rank. */
async function bundleSizes(db: Database, candidates: Candidate[]): Promise<Map<string, number>> {
  const names = [...new Set(candidates.map((c) => c.name))];
  if (names.length === 0) return new Map();
  const rows = await db
    .select({ name: packages.name, bundle: packages.bundleMinGzipKb })
    .from(packages)
    .where(inArray(packages.name, names));
  return new Map(rows.filter((r) => r.bundle != null).map((r) => [r.name, r.bundle as number]));
}

// ── Decomposition (document → needs) ─────────────────────────────────────────

async function decompose(document: string): Promise<{ needs: PlanNeed[]; source: 'llm' | 'heuristic' }> {
  const config = getConfig();
  if (config.SUMMARY_PROVIDER === 'openai' && config.SUMMARY_API_KEY) {
    const llm = await decomposeWithLlm(document, config.SUMMARY_API_KEY, config.SUMMARY_MODEL).catch(
      (err) => {
        logger.warn(`plan: LLM decomposition failed, using heuristic: ${(err as Error).message}`);
        return null;
      },
    );
    if (llm?.length) return { needs: dedupeNeeds(llm), source: 'llm' };
  }
  return { needs: decomposeHeuristic(document), source: 'heuristic' };
}

const DECOMPOSE_SYSTEM =
  'You break a software project description into the distinct technical components that each need a library. ' +
  'Return ONLY components the project actually requires, grounded in the description. Respond with a JSON object.';

async function decomposeWithLlm(
  document: string,
  apiKey: string,
  model: string,
): Promise<PlanNeed[]> {
  const prompt = [
    'Project description:',
    document.slice(0, 8000),
    '',
    'Return JSON: { "needs": [ { "need": "<one phrase describing a component that needs a library>", "category": "<optional taxonomy hint or empty>" } ] }.',
    'One entry per distinct component (e.g. routing, validation, ORM, HTTP client). Omit anything not implied by the description.',
  ].join('\n');
  const { data } = await httpRequest<any>('https://api.openai.com/v1/chat/completions', {
    host: 'api.openai.com',
    method: 'POST',
    ttlMs: 24 * 60 * 60 * 1000,
    // Hash the FULL document — length + a 64-char prefix collide for same-length
    // edits or shared templated headers, which would serve a stale decomposition.
    cacheKey: `openai-plan ${model} ${createHash('sha1').update(document).digest('hex')}`,
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model,
      messages: [
        { role: 'system', content: DECOMPOSE_SYSTEM },
        { role: 'user', content: prompt },
      ],
      response_format: { type: 'json_object' },
      temperature: 0.2,
    }),
  });
  const content = data?.choices?.[0]?.message?.content;
  const parsed = content ? JSON.parse(content) : {};
  const raw = Array.isArray(parsed?.needs) ? parsed.needs : [];
  return raw
    .map((n: any): PlanNeed | null => {
      const need = typeof n?.need === 'string' ? n.need.trim() : '';
      if (!need) return null;
      const cat = typeof n?.category === 'string' && isCategory(n.category) ? n.category : undefined;
      return { need, category: cat };
    })
    .filter(Boolean) as PlanNeed[];
}

/**
 * Heuristic fallback: scan the document line-by-line, infer a category per line,
 * and emit one need per distinct category (first matching line as the phrase).
 * Coarse by design — it only surfaces components whose category lurq can name.
 */
export function decomposeHeuristic(document: string): PlanNeed[] {
  const byCategory = new Map<Category, string>();
  for (const rawLine of document.split('\n')) {
    // Strip markdown headings/blockquotes/bullets, then an ordered-list "12. "
    // marker — but NOT bare leading digits, so "2FA auth" stays intact.
    const line = rawLine.replace(/^[#>*\-\s]+/, '').replace(/^\d+\.\s+/, '').trim();
    if (line.length < 3) continue;
    const category = inferCategory(line);
    if (category && !byCategory.has(category)) {
      byCategory.set(category, line.slice(0, 120));
    }
  }
  return [...byCategory.entries()].map(([category, need]) => ({ need, category }));
}
