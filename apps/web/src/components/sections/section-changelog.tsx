import Link from "next/link";
import { Container } from "@/components/common/container";
import { Reveal } from "@/components/common/reveal";
import { ChangelogChanges } from "@/components/sections/changelog-changes";
import { entries } from "@/content/changelog";

// Homepage teaser: the two most recent releases as editorial cards. Full
// history lives at /changelog.
const recent = entries.slice(0, 2);

export function SectionChangelog() {
  return (
    <section
      id="changelog"
      className="relative overflow-hidden border-t border-border py-24 md:py-32"
    >
      <Container>
        <Reveal>
          <div className="mx-auto max-w-3xl text-center">
            <h2 className="text-4xl font-semibold leading-[1.04] tracking-tight md:text-5xl">
              Shipping in the open.
            </h2>
            <p className="mx-auto mt-5 max-w-xl text-lg leading-relaxed text-muted-foreground">
              Every release, in plain text. No screenshots, no spin, just the
              log.
            </p>
          </div>
        </Reveal>

        <Reveal delay={0.1}>
          <div className="mx-auto mt-14 grid max-w-6xl items-start gap-6 md:grid-cols-2 lg:gap-8">
            {recent.map((entry, i) => (
              <article
                key={entry.version}
                className="surface-glow relative flex flex-col rounded-[var(--radius-lg)] border border-border bg-card p-8 md:p-10"
              >
                {/* index, top-right */}
                <span className="absolute right-8 top-8 font-mono text-xs text-muted-foreground/40 md:right-10 md:top-10">
                  {String(i + 1).padStart(2, "0")}
                </span>

                {/* kicker */}
                <p className="pr-8 font-mono text-[0.7rem] uppercase leading-relaxed tracking-[0.2em] text-muted-foreground/60">
                  {entry.badge ?? "Release"} · {entry.date}
                </p>

                {/* version */}
                <h3 className="mt-5 font-heading text-3xl font-semibold tracking-tight text-foreground md:text-4xl">
                  {/^\d/.test(entry.version) ? `v${entry.version}` : entry.version}
                </h3>

                {/* summary */}
                {entry.summary ? (
                  <p className="mt-4 text-[15px] leading-relaxed text-muted-foreground">
                    {entry.summary}
                  </p>
                ) : null}

                {/* changes: collapsed by default; the card resizes as it opens */}
                <ChangelogChanges changes={entry.changes} />
              </article>
            ))}
          </div>
        </Reveal>

        <Reveal delay={0.2}>
          <div className="mt-10 text-center">
            <Link
              href="/changelog"
              className="font-mono text-sm text-muted-foreground transition-colors hover:text-foreground"
            >
              → full changelog
            </Link>
          </div>
        </Reveal>
      </Container>
    </section>
  );
}
