import type { Metadata } from "next";
import Link from "next/link";
import { PageFrame, PageSection, SectionHeading } from "@/components/site/page-frame";
import { markFor, tintFor } from "@/components/site/source-marks";
import { CopyCommandButton } from "@/components/site/copy-command-button";
import {
  FIGURES,
  INDEX_HEAD,
  LIMITS,
  LIMITS_HEAD,
  METHOD,
  PROOF_HEAD,
  PROOF_LEAD,
  REPORTS_BODY,
  REPORTS_HEAD,
  REPRODUCE,
  REPRODUCE_BODY,
  REPRODUCE_HEAD,
  STATUS_BODY,
  STATUS_HEAD,
  SYNC,
} from "@/content/proof";
import { SOURCES } from "@/content/provenance";
import { CONTACT_EMAIL } from "@/content/copy";

export const metadata: Metadata = {
  title: "Evidence | lurq",
  description:
    "How every number on lurq.run is produced, what the index holds today, what it does not do, and the commands to check any of it.",
};

/**
 * The evidence page. See content/proof.ts for why it is this and not a logo
 * wall.
 *
 * THE LIMITS SECTION IS NOT A CONCESSION AND IT IS NOT AT THE BOTTOM. It sits
 * above the reproduce section on purpose: a reader who has just been handed
 * commands to check our claims should already know which claims we are not
 * making, or the first thing they will do is test a boundary we never said was
 * there and conclude the tool is broken.
 *
 * The sync status prints the pipeline's own word, `partial` included. A crawl
 * that read a fraction of the index and says so is the most useful fact on this
 * page for deciding how much to trust the rest of it, and rounding it up into a
 * green badge would be the one dishonest thing on a page about honesty.
 */

const fmtDate = (iso: string) =>
  new Date(iso).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });

export default function ProofPage() {
  const partial = SYNC.status !== "complete";

  return (
    <PageFrame eyebrow="Evidence" title={PROOF_HEAD} lead={PROOF_LEAD}>
      <PageSection>
        <SectionHeading>How a number gets made</SectionHeading>
        <ol className="mt-7 grid grid-cols-1 gap-x-8 gap-y-7 min-[720px]:grid-cols-2 min-[1100px]:grid-cols-4">
          {METHOD.map((stage, i) => (
            <li key={stage.title} className="border-t border-edge pt-4">
              <span className="font-mono text-[11px] text-ink-3">
                {String(i + 1).padStart(2, "0")}
              </span>
              <h3 className="mt-2.5 text-[14.5px] font-medium leading-snug text-ink">
                {stage.title}
              </h3>
              <p className="mt-2 text-[13px] leading-[1.65] text-ink-2">{stage.body}</p>
            </li>
          ))}
        </ol>
      </PageSection>

      <PageSection>
        <SectionHeading>{INDEX_HEAD}</SectionHeading>
        <dl className="mt-7 grid grid-cols-1 gap-x-8 gap-y-7 min-[560px]:grid-cols-2 min-[1100px]:grid-cols-3">
          {FIGURES.map((figure) => (
            <div key={figure.label} className="border-t border-edge pt-4">
              <dt className="sr-only">{figure.label}</dt>
              <dd>
                <span className="block font-sans text-[26px] font-medium tracking-[-0.025em] text-ink">
                  {figure.value}
                </span>
                <span className="mt-1.5 block text-[13px] font-medium text-ink">{figure.label}</span>
                <span className="mt-1.5 block text-[12.5px] leading-[1.6] text-ink-3">
                  {figure.note}
                </span>
              </dd>
            </div>
          ))}
        </dl>
      </PageSection>

      {/* The anchor the nav's Status row points at. */}
      <PageSection id="status">
        <div className="rounded-xl border border-edge border-t-edge-lit bg-surface p-6 min-[900px]:p-8">
          <div className="flex flex-col gap-6 min-[900px]:flex-row min-[900px]:items-start min-[900px]:justify-between min-[900px]:gap-12">
            <div className="min-[900px]:max-w-[46ch]">
              <SectionHeading className="!text-[17px]">{STATUS_HEAD}</SectionHeading>
              <p className="mt-3 text-[13px] leading-[1.65] text-ink-2">{STATUS_BODY}</p>
            </div>

            <dl className="grid shrink-0 grid-cols-2 gap-x-8 gap-y-5">
              <div>
                <dt className="font-mono text-[11px] uppercase tracking-[0.06em] text-ink-3">
                  Last crawl
                </dt>
                <dd className="mt-1.5 font-mono text-[13px] text-ink">
                  {fmtDate(SYNC.startedAt)}
                </dd>
              </div>
              <div>
                <dt className="font-mono text-[11px] uppercase tracking-[0.06em] text-ink-3">
                  Packages read
                </dt>
                <dd className="mt-1.5 font-mono text-[13px] text-ink">{SYNC.packagesUpdated}</dd>
              </div>
              <div>
                <dt className="font-mono text-[11px] uppercase tracking-[0.06em] text-ink-3">
                  Status
                </dt>
                {/* --conflict is a verdict colour and this is a verdict about
                    our own data, which is the one case where spending it on
                    ourselves is the honest use of it. */}
                <dd
                  className="mt-1.5 font-mono text-[13px]"
                  style={{ color: partial ? "var(--conflict)" : "var(--held)" }}
                >
                  {SYNC.status}
                </dd>
              </div>
              <div>
                <dt className="font-mono text-[11px] uppercase tracking-[0.06em] text-ink-3">
                  Days syncing
                </dt>
                <dd className="mt-1.5 font-mono text-[13px] text-ink">{SYNC.syncDays}</dd>
              </div>
            </dl>
          </div>
        </div>
      </PageSection>

      <PageSection>
        <SectionHeading>The ten hosts</SectionHeading>
        <p className="mt-3 max-w-[62ch] text-[13px] leading-[1.6] text-ink-2">
          Read from the generated provenance file, so a host added to or dropped from the pipeline
          changes this list without anyone editing copy.
        </p>
        <ul className="mt-7 grid grid-cols-1 gap-x-10 gap-y-1 min-[560px]:grid-cols-2 min-[1100px]:grid-cols-2">
          {SOURCES.map((source) => {
            const Glyph = markFor(source.host);
            return (
              <li
                key={source.host}
                className="flex flex-wrap items-baseline gap-x-3 gap-y-1 border-t border-edge py-3"
              >
                <Glyph
                  className="h-4 w-4 shrink-0 translate-y-0.5"
                  style={{ color: tintFor(source.host) }}
                />
                <span className="shrink-0 text-[13.5px] text-ink">{source.name}</span>
                <span className="font-mono text-[11.5px] text-ink-3">{source.host}</span>
                <span className="basis-full text-[12.5px] leading-[1.55] text-ink-2 min-[560px]:pl-7">
                  {source.contributes}
                </span>
              </li>
            );
          })}
        </ul>
      </PageSection>

      <PageSection>
        <SectionHeading>{LIMITS_HEAD}</SectionHeading>
        <div className="mt-7 grid grid-cols-1 gap-x-10 gap-y-7 min-[900px]:grid-cols-2">
          {LIMITS.map((limit) => (
            <div key={limit.title} className="border-t border-edge pt-4">
              <h3 className="text-[14.5px] font-medium leading-snug text-ink">{limit.title}</h3>
              <p className="mt-2 max-w-[54ch] text-[13px] leading-[1.65] text-ink-2">{limit.body}</p>
            </div>
          ))}
        </div>
      </PageSection>

      <PageSection>
        <SectionHeading>{REPRODUCE_HEAD}</SectionHeading>
        <p className="mt-3 max-w-[62ch] text-[13px] leading-[1.6] text-ink-2">{REPRODUCE_BODY}</p>

        <div className="mt-7 flex flex-col gap-4">
          {REPRODUCE.map((entry) => (
            <div
              key={entry.command}
              className="flex flex-col gap-3 border-t border-edge pt-4 min-[900px]:flex-row min-[900px]:items-start min-[900px]:gap-8"
            >
              <div className="min-[900px]:w-[360px] min-[900px]:shrink-0">
                <CopyCommandButton command={entry.command} label={entry.command} variant="outline" />
              </div>
              <p className="max-w-[56ch] text-[13px] leading-[1.65] text-ink-2">{entry.note}</p>
            </div>
          ))}
        </div>
      </PageSection>

      <PageSection>
        <div className="rounded-xl border border-edge bg-surface-2 p-6 min-[900px]:p-8">
          <SectionHeading className="!text-[17px]">{REPORTS_HEAD}</SectionHeading>
          <p className="mt-3 max-w-[64ch] text-[13.5px] leading-[1.7] text-ink-2">{REPORTS_BODY}</p>
          <div className="mt-6 flex flex-wrap items-center gap-x-6 gap-y-3">
            <Link
              href="/#contact"
              className="inline-flex h-10 items-center rounded-md bg-ink px-4 text-[13.5px] font-medium text-ground transition-[background-color] duration-(--dur-hover) hover:bg-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-mark"
            >
              Send one
            </Link>
            <a
              href={`mailto:${CONTACT_EMAIL}`}
              className="font-mono text-[12.5px] text-ink-2 transition-[color] duration-(--dur-hover) hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-mark"
            >
              {CONTACT_EMAIL}
            </a>
          </div>
        </div>
      </PageSection>
    </PageFrame>
  );
}
