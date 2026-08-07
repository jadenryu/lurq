import { Container, Label } from "@/components/marketing/primitives";
import { NPM_URL } from "@/lib/marketing-copy";
import { group, shortDate, stats } from "@/lib/marketing-data";

/**
 * Four figures on bare paper — no panel, no boxes. Individual developers trust
 * numbers they can check over logos they can't, so every one of these is read out
 * of the database by the generator and the download figure links to npm.
 *
 * This section is a held breath after the graph, so it gets space and nothing
 * else.
 *
 * Downloads are downloads. They are never called users.
 */
const FIGURES = [
  { value: stats.packagesScored, label: "packages scored" },
  { value: stats.versionsTracked, label: "versions tracked" },
  { value: stats.categories, label: "categories" },
  { value: stats.dataSources, label: "data sources, synced daily" },
];

export function SectionNumbers() {
  const { npm } = stats;

  return (
    <section className="border-t border-rule py-16 md:py-32">
      <Container>
        <Label>Where we are</Label>

        <dl className="grid grid-cols-2 gap-y-10 sm:grid-cols-4 sm:gap-y-0">
          {FIGURES.map((f) => (
            <div
              key={f.label}
              className="pr-4 [&:not(:first-child)]:border-l [&:not(:first-child)]:border-rule [&:not(:first-child)]:pl-6"
            >
              <dt className="sr-only">{f.label}</dt>
              <dd>
                <span className="block font-mono text-[2.5rem] leading-none tracking-tight text-ink">
                  {group(f.value)}
                </span>
                <span className="t-label mt-4 block">{f.label}</span>
              </dd>
            </div>
          ))}
        </dl>

        <p className="mt-14 font-mono text-[0.75rem] text-ink-soft">
          npm downloads: {group(npm.downloadsSincePublish)} in {npm.weeksLive} weeks
          since {shortDate(npm.firstPublishedAt)} ·{" "}
          <a
            href={NPM_URL}
            className="underline decoration-rule underline-offset-4 transition-colors duration-[120ms] hover:text-mark"
          >
            view on npm →
          </a>
          <span className="mx-2 text-rule">|</span>
          index last refreshed {shortDate(stats.dataAsOf)}
        </p>
      </Container>
    </section>
  );
}
