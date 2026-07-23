import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Container } from "@/components/common/container";
import { Reveal } from "@/components/common/reveal";
import { SectionLabel } from "@/components/common/section-label";
import { ContactForm } from "@/components/common/contact-form";
import { faqs } from "@/content/faq";

export function SectionFaq() {
  return (
    <section id="faq" className="relative border-t border-border py-24 md:py-32">
      <Container>
        <div className="grid gap-14 lg:grid-cols-[1.15fr_0.85fr] lg:gap-20">
          <Reveal>
            <SectionLabel index={4} className="mb-5">
              faq
            </SectionLabel>
            <h2 className="text-3xl font-medium lowercase leading-[1.08] tracking-tight md:text-4xl">
              questions, answered.
            </h2>
            <p className="mt-3 max-w-md text-base text-muted-foreground">
              What lurq is, how it differs from asking your model, and where the
              data comes from.
            </p>

            <Accordion className="mt-8 w-full border-t border-border">
              {faqs.map((item, i) => (
                <AccordionItem
                  key={item.q}
                  value={`item-${i}`}
                  className="border-border"
                >
                  <AccordionTrigger className="py-4 font-mono text-[0.95rem] font-normal hover:no-underline">
                    {item.q}
                  </AccordionTrigger>
                  <AccordionContent className="pb-5 text-[0.95rem] leading-relaxed text-muted-foreground">
                    {item.a}
                  </AccordionContent>
                </AccordionItem>
              ))}
            </Accordion>
          </Reveal>

          <Reveal delay={0.08}>
            <div
              id="contact"
              className="lg:sticky lg:top-[calc(var(--banner-h,0px)+5.5rem)]"
            >
              <p className="font-mono text-[0.7rem] uppercase tracking-[0.22em] text-muted-foreground/70">
                contact
              </p>
              <h3 className="mt-3 text-2xl font-medium lowercase leading-[1.1] tracking-tight md:text-3xl">
                still curious?
              </h3>
              <p className="mt-3 text-sm leading-relaxed text-muted-foreground md:text-base">
                Partnerships, edge cases, or a quick question. Send a note.
              </p>
              <div className="mt-7">
                <ContactForm />
              </div>
            </div>
          </Reveal>
        </div>
      </Container>
    </section>
  );
}
