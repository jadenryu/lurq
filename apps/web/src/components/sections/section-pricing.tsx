import { Check } from "lucide-react";
import { SignUpButton } from "@clerk/nextjs";
import { Button, buttonVariants } from "@/components/ui/button";
import { Container } from "@/components/common/container";
import { Reveal } from "@/components/common/reveal";
import { plans, type Plan } from "@/content/pricing";
import { cn } from "@/lib/utils";

function PlanCta({ plan }: { plan: Plan }) {
  if (plan.ctaType === "contact") {
    return (
      <a
        href="mailto:jadenryu@gmail.com?subject=lurq%20Enterprise"
        className={buttonVariants({
          variant: plan.featured ? "default" : "outline",
          className: "w-full",
        })}
      >
        {plan.cta}
      </a>
    );
  }
  return (
    <SignUpButton mode="modal">
      <Button
        variant={plan.featured ? "default" : "outline"}
        className="w-full"
      >
        {plan.cta}
      </Button>
    </SignUpButton>
  );
}

export function SectionPricing() {
  return (
    <section
      id="pricing"
      className="relative border-t border-border py-24 md:py-32"
    >
      <Container>
        <Reveal>
          <div className="mx-auto max-w-2xl text-center">
            <span className="text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">
              Pricing
            </span>
            <h2 className="mt-4 text-3xl font-semibold tracking-tight md:text-4xl">
              Simple pricing that scales with you.
            </h2>
            <p className="mt-4 text-muted-foreground">
              Start free on the CLI. Upgrade when your agent needs more.
            </p>
          </div>
        </Reveal>

        <div className="mx-auto mt-14 grid max-w-5xl items-stretch gap-6 md:grid-cols-3">
          {plans.map((plan, i) => (
            <Reveal key={plan.name} delay={i * 0.05} className="flex">
              <div
                className={cn(
                  "relative flex w-full flex-col rounded-[var(--radius-lg)] border bg-card p-7",
                  plan.featured
                    ? "border-foreground/25 shadow-2xl shadow-black/40"
                    : "border-border",
                )}
              >
                {plan.featured ? (
                  <>
                    <div className="pointer-events-none absolute inset-x-0 -top-px h-px bg-gradient-to-r from-transparent via-foreground/40 to-transparent" />
                    <span className="absolute right-6 top-7 rounded-full border border-border bg-secondary px-2.5 py-0.5 text-[11px] uppercase tracking-wide text-muted-foreground">
                      Most popular
                    </span>
                  </>
                ) : null}

                <h3 className="text-sm font-medium uppercase tracking-[0.14em] text-muted-foreground">
                  {plan.name}
                </h3>
                <div className="mt-4 flex items-baseline gap-1">
                  <span className="text-4xl font-semibold tracking-tight">
                    {plan.price}
                  </span>
                  <span className="text-muted-foreground">{plan.period}</span>
                </div>
                <p className="mt-3 text-sm text-muted-foreground">
                  {plan.description}
                </p>

                <ul className="mt-6 flex-1 space-y-3">
                  {plan.features.map((f) => (
                    <li key={f} className="flex items-start gap-3 text-sm">
                      <Check className="mt-0.5 size-4 shrink-0 text-foreground" />
                      <span className="text-muted-foreground">{f}</span>
                    </li>
                  ))}
                </ul>

                <div className="mt-8">
                  <PlanCta plan={plan} />
                </div>
              </div>
            </Reveal>
          ))}
        </div>
      </Container>
    </section>
  );
}
