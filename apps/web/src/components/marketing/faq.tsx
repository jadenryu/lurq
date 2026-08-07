import { Plus } from "lucide-react";
import { Container, Label } from "@/components/marketing/primitives";
import { FAQS } from "@/lib/marketing-copy";

/**
 * Native <details> rather than a scripted accordion: all closed on load, works
 * with no JavaScript, and the browser handles the keyboard for us. Hairline rules
 * between rows, no card wrapper.
 */
export function SectionFaq() {
  return (
    <section id="faq" className="border-t border-rule py-16 md:py-28">
      <Container>
        <Label>Questions</Label>

        <div className="grid gap-8 lg:grid-cols-12">
          <h2 className="t-h2 max-w-[16ch] text-ink lg:col-span-4">
            Questions, answered
          </h2>

          <div className="lg:col-span-7 lg:col-start-6">
            {FAQS.map((item) => (
              <details
                key={item.q}
                className="group border-t border-rule last:border-b"
              >
                <summary className="flex cursor-pointer list-none items-start justify-between gap-4 py-4 [&::-webkit-details-marker]:hidden">
                  <span className="t-h3 text-ink">{item.q}</span>
                  <Plus
                    aria-hidden
                    className="mt-0.5 size-4 shrink-0 text-ink-soft transition-transform duration-200 group-open:rotate-45"
                  />
                </summary>
                <p className="t-body pb-5 text-ink-soft">{item.a}</p>
              </details>
            ))}
          </div>
        </div>
      </Container>
    </section>
  );
}
