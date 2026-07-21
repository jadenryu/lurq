import Link from "next/link";
import { Logo } from "@/components/common/logo";
import { Container } from "@/components/common/container";

type FooterLink = { label: string; href: string; external?: boolean };

const columns: { title: string; links: FooterLink[] }[] = [
  {
    title: "Product",
    links: [
      { label: "How it works", href: "/#product" },
      { label: "Difference", href: "/#comparison" },
      { label: "Changelog", href: "/changelog" },
    ],
  },
  {
    title: "Company",
    links: [
      { label: "About", href: "/about" },
      { label: "Contact", href: "/#contact" },
      { label: "Partnerships", href: "/partnerships" },
    ],
  },
  {
    title: "Legal",
    links: [
      { label: "License (Apache-2.0)", href: "/license" },
      { label: "Privacy", href: "/privacy" },
      { label: "Terms", href: "/terms" },
    ],
  },
];

export function Footer() {
  return (
    <footer className="border-t border-border py-16">
      <Container>
        <div className="grid gap-10 md:grid-cols-[1.4fr_repeat(3,1fr)]">
          <div>
            <Logo />
            <p className="mt-3 max-w-xs text-sm text-muted-foreground">
              A live package index for AI coding tools. Helps agents pick
              libraries that work, and catch bad ones early.
            </p>
          </div>

          {columns.map((col) => (
            <div key={col.title}>
              <h4 className="font-mono text-xs uppercase tracking-[0.2em] text-muted-foreground/70">
                {col.title}
              </h4>
              <ul className="mt-4 space-y-3">
                {col.links.map((link) => (
                  <li key={link.label}>
                    {link.external ? (
                      <a
                        href={link.href}
                        className="text-sm text-muted-foreground transition-colors hover:text-foreground"
                      >
                        {link.label}
                      </a>
                    ) : (
                      <Link
                        href={link.href}
                        className="text-sm text-muted-foreground transition-colors hover:text-foreground"
                      >
                        {link.label}
                      </Link>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        <div className="mt-12 flex flex-col items-start justify-between gap-3 border-t border-border pt-8 font-mono text-xs text-muted-foreground/70 sm:flex-row sm:items-center">
          <span className="flex items-center gap-2">
            <span
              aria-hidden
              className="inline-block size-1.5 rounded-full bg-[#7dcea0] motion-safe:animate-pulse"
            />
            all systems operational
          </span>
          <span>© 2026 lurq · Apache-2.0</span>
        </div>
      </Container>
    </footer>
  );
}
