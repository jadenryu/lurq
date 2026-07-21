"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Menu } from "lucide-react";
import { useAuth, UserButton } from "@clerk/nextjs";
import { Button, buttonVariants } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetTrigger,
  SheetTitle,
  SheetClose,
} from "@/components/ui/sheet";
import { Logo } from "@/components/common/logo";
import { Container } from "@/components/common/container";
import { navLinks } from "@/content/nav";
import { cn } from "@/lib/utils";

export function Navbar() {
  const [scrolled, setScrolled] = useState(false);
  const { isSignedIn } = useAuth();

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <header
      className={cn(
        "fixed inset-x-0 top-[var(--banner-h,0px)] z-50 h-16 border-b transition-[top,background-color,border-color] duration-300",
        scrolled
          ? "border-border bg-background/80 backdrop-blur-md"
          : "border-transparent bg-transparent",
      )}
    >
      <Container className="relative flex h-16 items-center justify-between">
        <Link href="/" className="relative z-10">
          <Logo />
        </Link>

        {/* centered nav links */}
        <nav className="absolute left-1/2 hidden -translate-x-1/2 items-center gap-10 lg:gap-12 md:flex">
          {navLinks.map((l) => {
            const cls =
              "font-mono text-sm lowercase tracking-wide text-muted-foreground transition-colors hover:text-foreground";
            return l.external ? (
              <a key={l.href} href={l.href} className={cls}>
                {l.label}
              </a>
            ) : (
              <Link key={l.href} href={l.href} className={cls}>
                {l.label}
              </Link>
            );
          })}
        </nav>

        <div className="relative z-10 flex items-center gap-2">
          <div className="hidden items-center gap-2 md:flex">
            {isSignedIn ? (
              <>
                <Link
                  href="/book-demo"
                  className={buttonVariants({ variant: "ghost", size: "sm" })}
                >
                  Book a demo
                </Link>
                <UserButton />
              </>
            ) : (
              <>
                <Link
                  href="/sign-in"
                  className={buttonVariants({ variant: "ghost", size: "sm" })}
                >
                  Log in
                </Link>
                <Link
                  href="/book-demo"
                  className={buttonVariants({ size: "sm" })}
                >
                  Book a demo
                </Link>
              </>
            )}
          </div>

          {/* mobile */}
          <Sheet>
            <SheetTrigger
              className="md:hidden"
              render={
                <Button variant="ghost" size="icon" aria-label="Open menu" />
              }
            >
              <Menu className="size-5" />
            </SheetTrigger>
            <SheetContent side="right" className="w-72 bg-background p-6">
              <SheetTitle className="text-base">Menu</SheetTitle>
              <nav className="mt-6 flex flex-col gap-1">
                {navLinks.map((l) => (
                  <SheetClose
                    key={l.href}
                    className="rounded-md px-2 py-2 text-left text-sm text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
                    render={l.external ? <a href={l.href} /> : <Link href={l.href} />}
                  >
                    {l.label}
                  </SheetClose>
                ))}
              </nav>
              <div className="mt-6 flex flex-col gap-2">
                {isSignedIn ? (
                  <Link
                    href="/book-demo"
                    className={buttonVariants({ className: "w-full" })}
                  >
                    Book a demo
                  </Link>
                ) : (
                  <>
                    <SheetClose
                      render={<Link href="/sign-in" />}
                      className={buttonVariants({
                        variant: "outline",
                        className: "w-full",
                      })}
                    >
                      Log in
                    </SheetClose>
                    <Link
                      href="/book-demo"
                      className={buttonVariants({ className: "w-full" })}
                    >
                      Book a demo
                    </Link>
                  </>
                )}
              </div>
            </SheetContent>
          </Sheet>
        </div>
      </Container>
    </header>
  );
}
