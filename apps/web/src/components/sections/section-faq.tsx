import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Container } from "@/components/common/container";
import { Reveal } from "@/components/common/reveal";
import { ContactForm } from "@/components/common/contact-form";
import { faqs } from "@/content/faq";

export function SectionFaq() {
  return (
    <section id="faq" className="relative border-t border-border py-24 md:py-32">
      <Container>
        <Reveal>
          {/* liquid-metal oblong: bright metallic ring around a dark glass panel */}
          <div className="relative overflow-hidden rounded-[2.5rem] bg-[conic-gradient(from_140deg_at_50%_50%,#3f3f46,#d4d4d8,#52525b,#e4e4e7,#71717a,#27272a,#a1a1aa,#3f3f46)] p-0.5 shadow-2xl shadow-black/50">
            <div className="relative overflow-hidden rounded-[calc(2.5rem-2px)] bg-card/70 p-8 backdrop-blur-xl md:p-12 lg:p-16">
              {/* faint metallic sheen across the surface */}
              <div
                aria-hidden
                className="pointer-events-none absolute inset-0 bg-[conic-gradient(from_220deg_at_30%_15%,#e4e4e7,#52525b,#d4d4d8,#3f3f46,#a1a1aa,#e4e4e7)] opacity-[0.07]"
              />
              {/* top highlight */}
              <div
                aria-hidden
                className="pointer-events-none absolute inset-x-0 top-0 h-40 bg-gradient-to-b from-white/[0.06] to-transparent"
              />

              <div className="relative grid gap-12 lg:grid-cols-2 lg:gap-16">
                {/* left: questions */}
                <div>
                  <span className="text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">
                    FAQ
                  </span>
                  <h2 className="mt-4 text-3xl font-semibold tracking-tight md:text-4xl">
                    Frequently asked questions
                  </h2>
                  <Accordion className="mt-8 w-full">
                    {faqs.map((item, i) => (
                      <AccordionItem key={item.q} value={`item-${i}`}>
                        <AccordionTrigger className="text-left text-base">
                          {item.q}
                        </AccordionTrigger>
                        <AccordionContent className="text-muted-foreground">
                          {item.a}
                        </AccordionContent>
                      </AccordionItem>
                    ))}
                  </Accordion>
                </div>

                {/* right: contact */}
                <div className="lg:border-l lg:border-border/60 lg:pl-16">
                  <span className="text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">
                    Contact
                  </span>
                  <h3 className="mt-4 text-3xl font-semibold tracking-tight md:text-4xl">
                    Still have questions?
                  </h3>
                  <p className="mt-3 text-muted-foreground">
                    Reach out about the project, partnerships, or anything else
                    — we&apos;ll get back to you.
                  </p>
                  <div className="mt-8">
                    <ContactForm />
                  </div>
                </div>
              </div>
            </div>
          </div>
        </Reveal>
      </Container>
    </section>
  );
}
