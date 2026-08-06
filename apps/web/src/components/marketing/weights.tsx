import { Body, Container, Label } from "@/components/marketing/primitives";
import { CopyCommand } from "@/components/marketing/copy-command";
import { weights } from "@/lib/marketing-data";

/**
 * How the score is built.
 *
 * Read out of `src/scoring/weights.ts` by the generator, so the page cannot
 * disagree with the code that does the ranking. The bars are ink at varying
 * opacity rather than colour — a weight is not a verdict, and the verdict
 * colours are reserved.
 */
export function SectionWeights() {
  const { health, quality, composite, promising, reproduce, weightsSource } = weights;
  const max = Math.max(...health.map((h) => h.weight));

  return (
    <section id="weights" className="border-t border-rule py-16 md:py-28">
      <Container>
        <Label>How the score is built</Label>

        <div className="grid gap-8 lg:grid-cols-12">
          <div className="lg:col-span-4">
            <h2 className="t-h2 max-w-[20ch] text-balance text-ink">
              A ranking you can&apos;t inspect is just a different black box
            </h2>
            <Body className="mt-4">
              Four components, fixed weights, and each one traceable to the signal it
              came from. No model sits anywhere in this path — the same inputs produce
              the same number every time, and you can print the model and override it
              per project.
            </Body>
          </div>

          <div className="lg:col-span-7 lg:col-start-6">
            <p className="t-label mb-4">Health — weighted sum of four components</p>

            <dl>
              {health.map((h) => (
                <div
                  key={h.key}
                  className="border-t border-rule py-4 first:border-t-0 first:pt-0"
                >
                  <div className="flex items-baseline justify-between gap-4">
                    <dt className="t-h3 text-ink">{h.key}</dt>
                    <dd className="font-mono text-[0.9375rem] text-ink">
                      {h.weight.toFixed(2)}
                    </dd>
                  </div>
                  <div
                    aria-hidden
                    className="mt-2 h-1.5 w-full overflow-hidden rounded-[1px] bg-ink/[0.07]"
                  >
                    <div
                      className="h-full rounded-[1px] bg-ink"
                      style={{
                        width: `${(h.weight / max) * 100}%`,
                        // The lightest component still has to be legible, so the
                        // opacity floor is 0.4 rather than proportional to weight.
                        opacity: 0.4 + 0.6 * (h.weight / max),
                      }}
                    />
                  </div>
                  <p className="t-data mt-2 text-ink-soft">{h.signal}</p>
                </div>
              ))}
            </dl>

            <div className="mt-8 border-t border-rule pt-6">
              <p className="t-label">Quality — a second axis</p>
              <p className="t-data mb-4 mt-2 text-ink-soft">{quality.note}</p>
              <ul className="flex flex-wrap gap-x-4 gap-y-2">
                {quality.components.map((c) => (
                  <li key={c.key} className="t-data text-ink-soft">
                    {c.key}{" "}
                    <span className="text-ink-soft/55">{c.weight.toFixed(2)}</span>
                  </li>
                ))}
              </ul>
            </div>

            <div className="mt-8 border-t border-rule pt-6">
              <p className="t-label mb-3">The blend, for the default sort</p>
              <p className="font-mono text-[0.9375rem] text-ink">
                {composite.formula}
                <span className="mx-3 text-rule">·</span>λ ={" "}
                {composite.lambda.toFixed(2)}
              </p>
              <p className="t-data mt-4 text-ink-soft">
                Quality never feeds health. The two axes only meet here, at ranking
                time.
              </p>
            </div>

            <div className="mt-8 border-t border-rule pt-6">
              <p className="t-data text-ink-soft">
                A well-built new package with no downloads can still surface: the{" "}
                <span className="text-ink">promising</span> label needs a quality score
                of {promising.minQuality} and{" "}
                {`a release inside ${promising.maxLastReleaseMonths} months`}, and reads
                no download figure at all. Popularity isn&apos;t destiny, and
                that&apos;s enforced in the scoring rather than promised in a policy.
              </p>
              <div className="mt-5 max-w-sm">
                <CopyCommand command={reproduce} variant="line" />
              </div>
              <p className="t-label mt-3">
                prints the model above · currently {weightsSource}, overridable per
                project
              </p>
            </div>
          </div>
        </div>
      </Container>
    </section>
  );
}
