"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useAuth } from "@clerk/nextjs";
import { Container } from "@/components/marketing/primitives";
import { CopyCommand } from "@/components/marketing/copy-command";
import { StatusDot } from "@/components/marketing/status-dot";
import { DOCS_URL } from "@/lib/site-links";
import { INSTALL_COMMAND, REPO_URL } from "@/lib/marketing-copy";
import { cn } from "@/lib/utils";

/**
 * 56px, transparent until the page moves, then paper with a hairline bottom
 * rule. No blur — the page underneath is already light, so a frosted bar would
 * only add noise.
 *
 * The live status of the hosted server sits next to the wordmark. It's the best
 * trust signal the page has and it was previously below the footer, where nobody
 * was going to see it.
 *
 * There is no "get started free" button. The command is the call to action.
 */
export function SiteHeader() {
  const [scrolled, setScrolled] = useState(false);
  const { isSignedIn } = useAuth();

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  const link =
    "font-mono text-[0.8125rem] lowercase text-ink-soft transition-colors duration-[120ms] hover:text-mark";

  return (
    <header
      className={cn(
        "sticky top-0 z-50 h-14 transition-colors duration-200",
        scrolled
          ? "border-b border-rule bg-paper/[0.92]"
          : "border-b border-transparent",
      )}
    >
      <Container className="flex h-14 items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <Link
            href="/"
            className="font-mono text-[0.9375rem] text-ink transition-colors duration-[120ms] hover:text-mark"
            aria-label="lurq home"
          >
            lurq
          </Link>
          <StatusDot compact />
        </div>

        <nav className="flex items-center gap-5 sm:gap-6">
          <a href={DOCS_URL} className={cn(link, "hidden sm:inline")}>
            docs
          </a>
          <a href={REPO_URL} className={cn(link, "hidden sm:inline")}>
            github
          </a>
          <Link href={isSignedIn ? "/dashboard" : "/sign-in"} className={link}>
            {isSignedIn ? "dashboard" : "sign in"}
          </Link>
          <CopyCommand command={INSTALL_COMMAND} variant="chip" />
        </nav>
      </Container>
    </header>
  );
}
