import { Body, Container, Label } from "@/components/marketing/primitives";
import { LIMITS } from "@/lib/marketing-copy";

/**
 * What we don't do yet.
 *
 * Same visual weight as everything above it, and not styled as a roadmap tease.
 * This section is what makes the rest of the page believable to the people it is
 * for, and it means nobody can catch us out on something we already said.
 */
export function SectionLimits() {
  return (
    <section id="limits" className="border-t border-rule py-16 md:py-28">
      <Container>
        <Label>Current limits</Label>

        <div className="grid gap-8 lg:grid-cols-12">
          <div className="lg:col-span-4">
            <h2 className="t-h2 max-w-[22ch] text-balance text-ink">
              What lurq doesn&apos;t do yet
            </h2>
            <Body className="mt-4">
              Every one of these is something you could otherwise catch us out on later.
            </Body>
          </div>

          <dl className="lg:col-span-7 lg:col-start-6">
            {LIMITS.map((item, i) => (
              <div
                key={item.title}
                className={i === 0 ? "" : "mt-8 border-t border-rule pt-8"}
              >
                <dt className="t-h3 text-ink">{item.title}</dt>
                <dd className="mt-3">
                  <Body>{item.body}</Body>
                </dd>
              </div>
            ))}
          </dl>
        </div>
      </Container>
    </section>
  );
}
