import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Container } from "@/components/common/container";
import { Reveal } from "@/components/common/reveal";
import { faqs } from "@/content/faq";

export function SectionFaq() {
  return (
    <section id="faq" className="relative border-t border-border py-24 md:py-32">
      <Container>
        <Reveal>
          <div className="mx-auto max-w-3xl text-center">
            <span className="text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">
              FAQ
            </span>
            <h2 className="mt-4 text-3xl font-semibold tracking-tight md:text-4xl">
              Frequently asked questions
            </h2>
          </div>
        </Reveal>

        <Reveal delay={0.05}>
          <Accordion className="mx-auto mt-12 w-full max-w-3xl">
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
        </Reveal>
      </Container>
    </section>
  );
}
