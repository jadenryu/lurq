import type { Metadata } from "next";
import { PageFrame, PageSection } from "@/components/site/page-frame";
import {
  CHANGELOG_HEAD,
  CHANGELOG_LEAD,
  CHANGELOG_NO_NOTE,
  RELEASE_NOTES,
} from "@/content/releases";
import generated from "@/content/generated/releases.json";
import { REPO_URL } from "@/lib/marketing-copy";

export const metadata: Metadata = {
  title: "Changelog | lurq",
  description:
    "Every published version of the lurq CLI, with the date the npm registry stamped it.",
};

/**
 * The release timeline, joined from two sources that are allowed to know
 * different things.
 *
 * Versions and dates come from content/generated/releases.json, which
 * scripts/gen-releases.ts writes from the registry. Notes come from
 * content/releases.ts, which is written by hand. Neither can invent the other:
 * a version with no note renders the note's absence rather than a filler line,
 * and a note for a version that was never published renders nothing at all
 * because the loop is over the generated list.
 *
 * That last property is the reason this is built the way it is. There is a
 * v0.1.2 tag in the repo that has not been published, and a hand-written
 * changelog would list it.
 *
 * DATE FORMATTING IS PINNED. en-GB and UTC, like every other formatted date on
 * this site. An unpinned format is rendered once with the server's locale and
 * again with the visitor's, which is a hydration mismatch that only appears for
 * visitors outside the deploy region.
 */

const fmt = (iso: string) =>
  new Date(iso).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });

/** Colour is a verdict here only in the loosest sense, so the kinds are ink. */
const KIND_LABEL: Record<string, string> = {
  feature: "feature",
  fix: "fix",
  chore: "chore",
};

export default function ChangelogPage() {
  const { releases, latest, generatedAt } = generated;

  return (
    <PageFrame eyebrow="Changelog" title={CHANGELOG_HEAD} lead={CHANGELOG_LEAD}>
      <PageSection>
        <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-2 border-b border-edge pb-4">
          <p className="font-mono text-[11.5px] text-ink-2">
            {releases.length} published versions
            {latest && (
              <>
                <span aria-hidden className="px-2 text-edge-lit">
                  ·
                </span>
                latest {latest}
              </>
            )}
          </p>
          <p className="font-mono text-[11px] text-ink-3">Read from the registry {fmt(generatedAt)}</p>
        </div>

        <ol className="mt-2">
          {releases.map((release) => {
            const note = RELEASE_NOTES[release.version];
            return (
              <li
                key={release.version}
                className="grid grid-cols-1 gap-x-8 gap-y-2 border-b border-edge py-6 min-[720px]:grid-cols-[140px_1fr]"
              >
                <div className="flex items-baseline gap-3 min-[720px]:flex-col min-[720px]:gap-1.5">
                  <span className="font-mono text-[14px] text-ink">{release.version}</span>
                  <span className="font-mono text-[11.5px] text-ink-3">
                    {fmt(release.publishedAt)}
                  </span>
                </div>

                <div>
                  {note ? (
                    <>
                      <div className="flex items-baseline gap-2.5">
                        <span className="rounded-full border border-edge px-2 py-px font-mono text-[10.5px] text-ink-3">
                          {KIND_LABEL[note.kind]}
                        </span>
                        <h2 className="text-[14.5px] font-medium leading-snug text-ink">
                          {note.title}
                        </h2>
                      </div>
                      {note.body && (
                        <p className="mt-2 max-w-[64ch] text-[13px] leading-[1.65] text-ink-2">
                          {note.body}
                        </p>
                      )}
                    </>
                  ) : (
                    /* Not a filler sentence. "Various improvements" is what a
                       release nobody can describe gets written up as, and it is
                       worse than an honest blank. */
                    <p className="text-[13px] leading-[1.6] text-ink-3">
                      {CHANGELOG_NO_NOTE}{" "}
                      <a
                        href={REPO_URL}
                        target="_blank"
                        rel="noopener"
                        className="text-mark transition-[opacity] duration-[--dur-hover] hover:opacity-80 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-mark"
                      >
                        Open the repo
                        <span aria-hidden className="pl-1 text-[10px] opacity-70">
                          ↗
                        </span>
                      </a>
                    </p>
                  )}
                </div>
              </li>
            );
          })}
        </ol>

        <p className="mt-6 max-w-[72ch] font-mono text-[11px] leading-[1.6] text-ink-3">
          Generated by scripts/gen-releases.ts from {generated.source}. A version tagged in the repo
          but not published to npm does not appear here, which is the point of reading the registry
          rather than the tags.
        </p>
      </PageSection>
    </PageFrame>
  );
}
