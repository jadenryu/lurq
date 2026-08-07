/**
 * Published knowledge cutoffs for the models people actually code against.
 *
 * Every date here was transcribed from the vendor's own documentation and
 * checked on 2026-08-07. Nothing on this list is inferred, rounded, or recalled.
 * A date we cannot point at a vendor page for does not go on the list at all,
 * because the board underneath it claims to be measured.
 *
 * The three vendors publish differently, and this type follows their shape
 * rather than flattening it:
 *
 *   Anthropic publishes two dates per model, and the gap between them is the
 *   whole reason this file is careful. `cutoff` is the "reliable knowledge
 *   cutoff", the date through which the vendor says a model's knowledge is most
 *   extensive and reliable. `training` is the broader range of training data
 *   used. The board draws the earlier one, because that is the date the vendor
 *   is willing to stand behind, and because the tail of a training window is
 *   exactly where coverage is thin. Sonnet 4.6 is the clearest case: reliable
 *   Aug 2025, training Jan 2026, five months apart. Taking the later number
 *   would quietly shrink the drift the board exists to show, in our own favour.
 *
 *   OpenAI publishes one date, to the day.
 *
 *   Google publishes one date, to the month, and shares it across the whole
 *   Gemini 3 line no matter when each model in it shipped.
 *
 * A vendor that publishes month precision is stored as the 1st of that month.
 * Writing a day the vendor did not publish would be inventing precision, and
 * the board is a page about people inventing precision.
 *
 * The list is one model per distinct cutoff date, which is what the generator
 * buckets on. Models omitted because they share a date already here: Claude
 * Fable 5 and Claude Opus 4.8 (Jan 2026, same as Sonnet 5), and the three
 * GPT-5.6 variants Sol, Terra and Luna, which share Feb 16 2026.
 */
export type Vendor = "Anthropic" | "OpenAI" | "Google";

export type ModelCutoff = {
  vendor: Vendor;
  /** What a person calls it. */
  label: string;
  /** ISO date of the published cutoff. The 1st where the vendor publishes only a month. */
  cutoff: string;
  /** The broader training window, where the vendor publishes the split. */
  training?: string;
  /** The page the date was read from. Rendered as a link, so it stays checkable. */
  source: string;
};

const ANTHROPIC_SOURCE =
  "https://platform.claude.com/docs/en/about-claude/models/overview";
const OPENAI_SOURCE = "https://developers.openai.com/api/docs/models";
const GOOGLE_SOURCE = "https://ai.google.dev/gemini-api/docs/gemini-3";

/** Newest cutoff first: the default pick should be the most current model. */
export const MODEL_CUTOFFS: ModelCutoff[] = [
  {
    vendor: "Anthropic",
    label: "Claude Opus 5",
    cutoff: "2026-05-01",
    training: "2026-05-01",
    source: ANTHROPIC_SOURCE,
  },
  {
    vendor: "OpenAI",
    label: "GPT-5.6",
    cutoff: "2026-02-16",
    source: OPENAI_SOURCE,
  },
  {
    vendor: "Anthropic",
    label: "Claude Sonnet 5",
    cutoff: "2026-01-01",
    training: "2026-01-01",
    source: ANTHROPIC_SOURCE,
  },
  {
    vendor: "OpenAI",
    label: "GPT-5.5",
    cutoff: "2025-12-01",
    source: OPENAI_SOURCE,
  },
  {
    vendor: "Anthropic",
    label: "Claude Sonnet 4.6",
    cutoff: "2025-08-01",
    training: "2026-01-01",
    source: ANTHROPIC_SOURCE,
  },
  {
    vendor: "Google",
    label: "Gemini 3",
    cutoff: "2025-01-01",
    source: GOOGLE_SOURCE,
  },
];

/**
 * The distinct dates the generator has to produce a board for, newest first.
 * Two models on the same cutoff are the same query, so they share a bucket.
 */
export const CUTOFF_DATES: string[] = [
  ...new Set(MODEL_CUTOFFS.map((m) => m.cutoff)),
].sort((a, b) => (a < b ? 1 : -1));
