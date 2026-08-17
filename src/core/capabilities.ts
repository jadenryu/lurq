/**
 * What lurq can do, as data.
 *
 * lurq has eleven MCP tools, sixteen CLI commands and seven dashboard pages, and
 * the honest problem with that is nobody — human or agent — holds the map. An
 * agent with `verify` in its tool list still writes `npm install` and hopes; a
 * user staring at a drift number does not know `check-upgrade` is the thing that
 * tells them whether it matters. Both failures are the same failure: the
 * capability exists and is not findable at the moment it is needed.
 *
 * So the catalog is indexed by the *question*, not by the endpoint. Entries are
 * jobs ("am I about to break my consumers?"), and each one carries the exact
 * next move on every surface that can do it. A match is not an explanation, it
 * is a command to run or a tool to call.
 *
 * Deliberately not embeddings. The corpus is twenty entries of controlled
 * vocabulary that we write ourselves — a scorer over titles, questions and
 * aliases beats a vector search at this size, costs nothing, needs no key, and
 * returns the same answer every time. When the catalog outgrows a screen, or
 * when queries start arriving in words we never anticipated, revisit.
 * ponytail: token scorer; move to `src/search/embeddings` if recall drops.
 */

export type Surface = 'mcp' | 'cli' | 'dashboard';

export interface Capability {
  id: string;
  /** Imperative, five words or fewer. This is the palette row's headline. */
  title: string;
  /** The user's question in their words — what they'd type into the box. */
  question: string;
  /** One sentence on what lurq actually does, and what it will not claim. */
  answer: string;
  /** The MCP tool an agent should call. */
  mcp?: string;
  /** A runnable command, with placeholders in <angle brackets>. */
  cli?: string;
  /** A dashboard route, when a page is the better answer than a command. */
  page?: string;
  /** Extra vocabulary the title and question don't contain. */
  aliases?: string[];
}

export const CAPABILITIES: Capability[] = [
  {
    id: 'verify',
    title: 'Check a package is real',
    question: 'Does this package actually exist, and is it safe to install?',
    answer:
      'Checks the live registry for existence, deprecation, archival and advisories — the guard against a hallucinated or typosquatted name reaching package.json.',
    mcp: 'verify',
    cli: 'lurq verify <package>',
    aliases: ['hallucinated', 'typosquat', 'slopsquat', 'fake', 'malicious', 'safe', 'exists'],
  },
  {
    id: 'recommend',
    title: 'Pick a package for a need',
    question: 'What should I use for this?',
    answer:
      'Returns evidence-scored candidates for a described need, with a confidence label on each. Ranks from current signals, not from what was popular at a training cutoff.',
    mcp: 'recommend',
    cli: 'lurq recommend "<what you need>"',
    aliases: ['choose', 'library', 'best', 'alternative', 'which'],
  },
  {
    id: 'evaluate',
    title: 'Read the evidence on a package',
    question: 'Is this package healthy, maintained, and worth adopting?',
    answer:
      'The full evidence read for one package: health and quality scores with the signals behind them, release cadence, advisories, and how to wire it up.',
    mcp: 'evaluate',
    cli: 'lurq evaluate <package>',
    aliases: ['health', 'maintained', 'abandoned', 'deprecated', 'score', 'quality'],
  },
  {
    id: 'compare',
    title: 'Compare packages side by side',
    question: 'Which of these two should I go with?',
    answer: 'Ranks 2–5 named packages against each other on the same scored evidence.',
    mcp: 'compare',
    cli: 'lurq compare <a> <b>',
    aliases: ['versus', 'vs', 'shootout', 'better'],
  },
  {
    id: 'compat',
    title: 'Check a stack fits together',
    question: 'Will these packages work together?',
    answer:
      'Peer-dependency and engine checks across the whole set at once, plus any sandbox-verified conflicts on record. Returns the exact clashing constraints.',
    mcp: 'compat',
    cli: 'lurq compat <a> <b> <c>',
    aliases: ['peer', 'conflict', 'incompatible', 'engines', 'node version', 'together'],
  },
  {
    id: 'usage',
    title: 'See a version-exact API',
    question: 'What does this package actually export at this version?',
    answer:
      'The exported symbols and signatures for one exact version, read from the shipped JS — plus the delta from a version you already know.',
    mcp: 'usage',
    cli: 'lurq usage <package> --target <version>',
    aliases: ['exports', 'symbols', 'api', 'signature', 'surface'],
  },
  {
    id: 'diff-surface',
    title: 'See what an upgrade removes',
    question: 'What breaks between these two versions?',
    answer:
      'The symbol-level diff between two published versions: what was removed, what changed arity, what is new. Runtime breakage is reported separately from type-only breakage.',
    mcp: 'diff_surface',
    cli: 'lurq usage <package> --known <old> --target <new>',
    aliases: ['breaking', 'removed', 'changed', 'migration', 'major'],
  },
  {
    id: 'plan',
    title: 'Turn a spec into a stack',
    question: 'I have a project description — what should I build it with?',
    answer:
      'Decomposes a written spec into component slots, recommends a scored package per slot, and optimises the set for compatibility. A starter stack, not an architecture.',
    mcp: 'plan',
    cli: 'lurq plan <file.md> --open',
    aliases: ['spec', 'readme', 'greenfield', 'scaffold', 'roadmap', 'stack'],
  },
  {
    id: 'diagram',
    title: 'Draw the stack',
    question: 'Can I see this as a diagram?',
    answer: 'Renders a planned or existing stack as a Mermaid graph other tools can parse.',
    mcp: 'diagram',
    cli: 'lurq plan <file.md> --html <out.html>',
    aliases: ['mermaid', 'visual', 'chart', 'architecture', 'graph'],
  },
  {
    id: 'upgrade-plan',
    title: 'Find what is behind',
    question: 'How far out of date is this project?',
    answer:
      'Reads the local manifests and reports the gap between what is resolved and what is current, with what each upgrade removes from its API. Sends dependency ranges only, never source.',
    cli: 'lurq upgrade-plan',
    page: '/dashboard/repos',
    aliases: ['drift', 'outdated', 'behind', 'stale', 'update', 'upgrade', 'bump', 'dependencies'],
  },
  {
    id: 'check-upgrade',
    title: 'Check an upgrade against your code',
    question: 'Will this upgrade break my code specifically?',
    answer:
      'Intersects what the upgrade removes with what your code actually references, and answers with file:line. Needs no test suite and no network to lurq.',
    cli: 'lurq check-upgrade --plan plan.json --exit-code',
    aliases: ['breaking', 'ci', 'gate', 'call sites', 'references', 'blocking'],
  },
  {
    id: 'check-release',
    title: 'Check your own version bump',
    question: 'Am I about to break my consumers?',
    answer:
      'Compares the built working tree against your last published version and says whether the bump you are about to tag covers what actually changed. For package authors.',
    cli: 'lurq check-release --exit-code',
    aliases: ['publish', 'semver', 'release', 'major', 'prepublish', 'library author'],
  },
  {
    id: 'check-api',
    title: 'Check your own API for breaks',
    question: 'Will this change break the people calling my service?',
    answer:
      'Diffs two git revisions of your OpenAPI document: removed operations, newly required parameters and body fields, removed response codes — and whether info.version was bumped enough. Reads git only, nothing leaves the machine.',
    cli: 'lurq check-api --against origin/main --exit-code',
    aliases: ['openapi', 'swagger', 'endpoint', 'consumers', 'callers', 'service', 'contract', 'rest'],
  },
  {
    id: 'autopilot',
    title: 'Keep a repo current automatically',
    question: 'Can lurq just do the upgrades for me?',
    answer:
      'Connect a repo and lurq drafts the upgrade, names the call sites it breaks, and opens a PR from your own runner. lurq never gets write access to your code.',
    page: '/dashboard/repos',
    cli: 'lurq upgrade-plan --json',
    aliases: ['automate', 'pr', 'github', 'renovate', 'dependabot', 'autopilot', 'workflow'],
  },
  {
    id: 'policy',
    title: 'Set what agents may install',
    question: 'How do I stop agents adding packages we do not allow?',
    answer:
      'An allow/deny list plus licence and confidence floors, enforced at the moment an agent reaches for a dependency — before it becomes a line in package.json.',
    page: '/dashboard/policy',
    aliases: ['allowlist', 'whitelist', 'deny', 'blocklist', 'licence', 'license', 'govern', 'standard'],
  },
  {
    id: 'alerts',
    title: 'Watch repos for new risk',
    question: 'Tell me when something I depend on goes bad',
    answer:
      'Per-repo advisories and deprecations across the resolved tree, with the direct dependency responsible for each transitive finding.',
    page: '/dashboard/repos',
    aliases: ['advisory', 'cve', 'vulnerability', 'security', 'transitive', 'sbom', 'alert'],
  },
  {
    id: 'usage-dashboard',
    title: 'See how lurq is being used',
    question: 'Who on my team is calling lurq, and how much?',
    answer: 'Call volume by tool and by day, plus the outcomes reported back after a recommendation.',
    page: '/dashboard/usage',
    aliases: ['activity', 'analytics', 'volume', 'calls', 'team', 'adoption', 'heatmap'],
  },
  {
    id: 'setup',
    title: 'Connect lurq to an assistant',
    question: 'How do I get this into Claude Code / Cursor?',
    answer:
      'One command detects every assistant on the machine and writes the MCP entry. No database credentials touch your machine.',
    cli: 'npx lurqrun',
    page: '/dashboard/keys',
    aliases: ['install', 'mcp', 'cursor', 'claude code', 'windsurf', 'copilot', 'api key', 'onboard'],
  },
  {
    id: 'weights',
    title: 'Change how scoring works',
    question: 'I disagree with the ranking — can I tune it?',
    answer:
      'Show the weight model, or layer your own overrides on top of the defaults, per user or per project.',
    cli: 'lurq edit-weights --set composite.lambda=0.5',
    aliases: ['scoring', 'ranking', 'tune', 'bias', 'lambda', 'override'],
  },
  {
    id: 'report-outcome',
    title: 'Tell lurq how it went',
    question: 'How does lurq learn from what I picked?',
    answer:
      'An opt-in report of whether you took the recommendation and whether it built. Coarse signal only — never source code.',
    mcp: 'report_outcome',
    aliases: ['feedback', 'outcome', 'accepted', 'flywheel', 'learn'],
  },
];

/** Words carrying no discriminating signal in a corpus of questions about lurq. */
const STOP = new Set([
  'a', 'an', 'the', 'is', 'it', 'i', 'my', 'me', 'do', 'does', 'how', 'what', 'which', 'to', 'for',
  'of', 'in', 'on', 'and', 'or', 'can', 'with', 'this', 'that', 'be', 'am', 'are', 'should', 'lurq',
  'package', 'packages',
]);

/** Hyphens split: `check-upgrade` has to be findable by "upgrade" alone. */
const tokenize = (s: string): string[] =>
  s
    .toLowerCase()
    .split(/[^a-z0-9.@/]+/)
    .filter((t) => t.length > 1 && !STOP.has(t));

/**
 * Crude stemming by shared prefix, at half weight. English inflection mostly
 * happens at the end of a word, and a five-character agreement catches the cases
 * that matter here — upgrading/upgrade, dependencies/dependency, breaking/breaks
 * — which a `startsWith` check does not (they diverge before the suffix). A real
 * stemmer is a dependency and a lookup table for twenty entries of vocabulary we
 * control; this is the rung below it that works.
 */
const STEM_LEN = 5;
const sameStem = (a: string, b: string): boolean =>
  a.length >= STEM_LEN && b.length >= STEM_LEN && a.slice(0, STEM_LEN) === b.slice(0, STEM_LEN);

/**
 * Field weights. `aliases` outscores `answer` on purpose: an alias is a word we
 * chose *because* someone would search for it, whereas a hit in the answer prose
 * is often incidental.
 */
const FIELDS: { of: (c: Capability) => string; weight: number }[] = [
  { of: (c) => c.title, weight: 5 },
  { of: (c) => c.question, weight: 4 },
  { of: (c) => (c.aliases ?? []).join(' '), weight: 3 },
  { of: (c) => c.answer, weight: 1 },
  { of: (c) => [c.mcp, c.cli, c.page].filter(Boolean).join(' '), weight: 4 },
];

export interface CapabilityMatch extends Capability {
  score: number;
}

/**
 * Rank capabilities against a free-text query.
 *
 * A prefix match counts at half weight so "upgrading" finds "upgrade" and
 * "dependencies" finds "dependency" without a stemmer. An empty or unmatched
 * query returns the catalog in declaration order rather than nothing — for a
 * palette that is the browse state, and for an agent it is the full menu, which
 * is a better answer to "what can you do" than silence.
 */
export function searchCapabilities(query: string, limit = 5): CapabilityMatch[] {
  const terms = tokenize(query ?? '');
  if (!terms.length) return CAPABILITIES.slice(0, limit).map((c) => ({ ...c, score: 0 }));

  const scored = CAPABILITIES.map((c) => {
    let score = 0;
    for (const { of, weight } of FIELDS) {
      const haystack = tokenize(of(c));
      for (const term of terms) {
        if (haystack.includes(term)) score += weight;
        else if (haystack.some((h) => sameStem(h, term))) score += weight / 2;
      }
    }
    return { ...c, score };
  }).filter((c) => c.score > 0);

  if (!scored.length) return CAPABILITIES.slice(0, limit).map((c) => ({ ...c, score: 0 }));
  return scored.sort((a, b) => b.score - a.score).slice(0, limit);
}
