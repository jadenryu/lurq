import Link from "next/link";
import { Container } from "@/components/common/container";
import { buttonVariants } from "@/components/ui/button";

export function SectionCta() {
  return (
    <section className="relative overflow-hidden border-t border-border py-28 md:py-36">
      <div aria-hidden className="pointer-events-none absolute inset-0 -z-10">
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_70%_55%_at_50%_40%,rgba(255,255,255,0.07),transparent_68%)]" />
        <div className="bg-grid absolute inset-0 opacity-30" />
      </div>

      <Container>
        <div className="mx-auto max-w-3xl text-center">
          <p className="font-mono text-[0.7rem] uppercase tracking-[0.28em] text-muted-foreground/70">
            next step
          </p>

          <h2 className="mt-6 font-heading text-4xl font-medium lowercase leading-[1.05] tracking-tight sm:text-5xl md:text-6xl">
            try lurq now
            <br />
            <span className="text-muted-foreground">(yes, it&apos;s free)</span>
          </h2>

          <p className="mx-auto mt-5 max-w-md text-base leading-relaxed text-muted-foreground md:text-lg">
            Create your account, generate an API key, and connect your coding
            agent to the live package market.
          </p>

          <div className="mt-9 flex flex-col items-center gap-5">
            <Link
              href="/sign-up"
              className={buttonVariants({
                size: "lg",
                className: "cta-glow h-12 px-8 text-base",
              })}
            >
              start free
            </Link>
            <p className="font-mono text-[0.7rem] text-muted-foreground/50">
              free to get started
            </p>
          </div>
        </div>
      </Container>
    </section>
  );
}
