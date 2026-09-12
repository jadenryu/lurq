/**
 * When a re-ingest may skip the two paid calls (LLM summary, embedding).
 *
 * Both are derived purely from a package's published latest version: the summary
 * reads that version's README and manifest, and the embedding is built from the
 * name, category and that summary. So if the stored row is already at the
 * version npm currently calls latest, regenerating either buys a fresh copy of
 * an identical answer at full price.
 *
 * This is the same argument `graph_scanned_version` already makes for the
 * discovery graph channel (deps are version-pinned, so an unchanged version has
 * unchanged neighbours) applied to the other two per-package costs.
 *
 * Why this lives here rather than in the 30d HTTP cache both call sites ask for:
 * that cache is on local disk (`core/http.ts` → `~/.cache/lurq/http`), and every
 * production process is an ephemeral container, so it is cold on every run and
 * has never produced a hit in prod. Postgres is the thing that actually persists,
 * and it already holds both values.
 */
import type { UsageGuide } from '../core/types';

/** The stored fields a reuse decision reads. A subset of `PackageRow`. */
export interface ReusableFields {
  latestVersion: string | null;
  summary: string | null;
  usageGuide: UsageGuide | null;
  embedding: number[] | null;
  embeddingProvider: string | null;
}

/**
 * Whether `existing` still describes the package at `latestVersion`.
 *
 * Every field is required, not just the version: a row can be at the right
 * version and still be missing a summary (the LLM failed and the fallback stored
 * null) or an embedding (added to the schema after the row was written), and
 * reusing a null would make the gap permanent — the one bug that would be worse
 * than the cost this function exists to avoid.
 *
 * `embeddingProvider` is compared because a vector is only meaningful inside the
 * space that produced it. Switching `EMBEDDING_MODEL` therefore re-embeds
 * everything on the next pass, which is the correct and intended expense.
 */
export function canReuse(
  existing: ReusableFields | null | undefined,
  latestVersion: string | null,
  embeddingProviderId: string,
): boolean {
  if (!existing || !latestVersion) return false;
  return (
    existing.latestVersion === latestVersion &&
    existing.summary !== null &&
    existing.usageGuide !== null &&
    existing.embedding !== null &&
    existing.embeddingProvider === embeddingProviderId
  );
}
