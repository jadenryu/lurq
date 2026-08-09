/**
 * The canonical descriptions for the three tools the benchmark's agent arms
 * expose, in one place because they were being written twice.
 *
 * server.ts is what real agents see. The benchmark participants each hand-wrote
 * their own paraphrase of the same three tools — once per vendor schema shape —
 * and those paraphrases drifted well below the originals. `compat` is the clear
 * case: production says "across the whole set ... call before committing to a
 * multi-package stack", the benchmark's copy said only "check if packages are
 * compatible", and the measured consequence was the model calling `compat` four
 * separate times on a two-need case instead of once with the whole set. Every
 * one of those extra turns resends the entire accumulated context, so a weaker
 * sentence here was costing real tokens and real latency.
 *
 * That made the benchmark measure a worse lurq than the one that ships — the
 * arm meant to show what the tools are worth was describing them badly. Hence
 * one source: a description improved for agents is now improved for the number
 * we publish about them, and neither can quietly fall behind the other.
 *
 * Only these three are extracted, not all nine tools on the server. The other
 * six have exactly one caller and gain nothing from the indirection.
 */

export const PLAN_DESCRIPTION =
  'Turn a detailed program description (spec/README) or a list of component needs into an evidence-scored build plan: a real, lurq-scored package recommended per component, plus a Mermaid roadmap other agents can parse. Recommends building blocks slot-by-slot from the index, it does not invent an architecture from a bare prompt.';

export const VERIFY_DESCRIPTION =
  'Confirm an npm package is real, healthy, and not risky before installing, guards against hallucinated or typosquatted dependency names. Checks the live registry.';

export const COMPAT_DESCRIPTION =
  'Check whether a set of packages forms a coherent stack: peer-dependency and engine-range compatibility across the whole set (instant, from declared metadata), plus any recorded sandbox-verified conflicts. Returns the exact clashing constraints. Read-only, does not run installs. Call before committing to a multi-package stack.';

/**
 * The `packages` parameter carries the batching instruction, not just the
 * bound. A model told the argument is a set checks the set; a model told only
 * that it is an array checks pairs, one round trip at a time, which is what it
 * actually did before this said otherwise.
 */
export const COMPAT_PACKAGES_DESCRIPTION =
  'The full candidate stack to check together, 2–8 npm package names. Pass every package in one call, checking pairs separately misses conflicts that only appear across the whole set, and costs a round trip each.';

export const COMPAT_VERSIONS_DESCRIPTION =
  'Optional exact versions keyed by package name (use when not checking latest)';

export const COMPAT_NODE_DESCRIPTION =
  'Optional target Node runtime (e.g. "20" or "20.20.2") for engines.node checks';
