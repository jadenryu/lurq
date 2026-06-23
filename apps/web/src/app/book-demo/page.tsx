import Link from "next/link";
import type { Metadata } from "next";
import { Container } from "@/components/common/container";
import { Logo } from "@/components/common/logo";
import { CalendlyEmbed } from "@/components/common/calendly-embed";

export const metadata: Metadata = {
  title: "Book a demo | lurq",
};

export default function BookDemoPage() {
  return (
    <div className="flex min-h-svh flex-col">
      <header className="h-16 border-b border-border">
        <Container className="flex h-16 items-center">
          <Link href="/">
            <Logo />
          </Link>
        </Container>
      </header>

      <main className="flex-1 py-12 md:py-16">
        <div className="mx-auto max-w-3xl px-6">
          <div className="text-center">
            <span className="text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">
              You&apos;re in
            </span>
            <h1 className="mt-3 text-3xl font-semibold tracking-tight md:text-4xl">
              Book your lurq demo
            </h1>
            <p className="mt-3 text-muted-foreground">
              Pick a time that works and we&apos;ll walk you through lurq live.
            </p>
          </div>
          <div className="mt-10">
            <CalendlyEmbed />
          </div>
        </div>
      </main>
    </div>
  );
}
