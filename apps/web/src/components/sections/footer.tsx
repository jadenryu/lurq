import Link from "next/link";
import { Logo } from "@/components/common/logo";
import { Container } from "@/components/common/container";

type FooterLink = { label: string; href: string; external?: boolean };

const columns: { title: string; links: FooterLink[] }[] = [
  {
    title: "Product",
    links: [
      { label: "Features", href: "/#product" },
      { label: "Reviews", href: "/#reviews" },
      { label: "Changelog", href: "/changelog" },
    ],
  },
  {
    title: "Docs",
    links: [
      { label: "Quickstart", href: "/docs/quickstart", external: true },
      { label: "CLI usage", href: "/docs/cli", external: true },
      { label: "MCP tools", href: "/docs/mcp-tools", external: true },
      { label: "How it works", href: "/docs/how-it-works", external: true },
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
        <div className="grid gap-10 md:grid-cols-[1.4fr_repeat(4,1fr)]">
          <div>
            <Logo />
            <p className="mt-3 max-w-xs text-sm text-muted-foreground">
              Objective package recommendations for AI coding agents - fresh,
              scored, and verifiable.
            </p>
          </div>

          {columns.map((col) => (
            <div key={col.title}>
              <h4 className="text-sm font-medium text-foreground">
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

        <div className="mt-12 flex flex-col items-start justify-between gap-3 border-t border-border pt-8 text-sm text-muted-foreground/70 sm:flex-row sm:items-center">
          <span>© 2026 lurq. All rights reserved.</span>
          <span>Apache License 2.0</span>
        </div>
      </Container>
    </footer>
  );
}
