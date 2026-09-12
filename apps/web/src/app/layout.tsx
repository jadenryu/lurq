import type { Metadata, Viewport } from "next";
import { Analytics } from "@vercel/analytics/next";
import { SpeedInsights } from "@vercel/speed-insights/next";
import { ClerkProvider } from "@clerk/nextjs";
import { dark } from "@clerk/themes";
import { TooltipProvider } from "@/components/ui/tooltip";
import { geist, commitMono } from "@/lib/fonts";
import { SITE_ORIGIN } from "@/lib/site";
import "./globals.css";
// After globals.css on purpose: the dark-room palette re-declares --ink,
// --conflict, --declared and --mark for a near-black ground, and the later
// declaration is the one that wins.
import "./styles/tokens.css";

// TITLE mirrors the home page h1 (components/marketing/hero.tsx).
const TITLE = "lurq | your agent picks the packages, lurq knows what happens next";
const DESCRIPTION =
  "lurq is the verification infra behind your agent's choices, from package selection to dynamic upkeeping. lurq combats version drift while returning tangible results, fast.";

export const metadata: Metadata = {
  // Canonical base for resolving relative metadata URLs (canonical, OG images).
  // SITE_ORIGIN normalizes the apex to the non-redirecting www host (see lib/site).
  metadataBase: new URL(SITE_ORIGIN),
  title: TITLE,
  description: DESCRIPTION,
  alternates: { canonical: "/" },
  // og:image is auto-injected from app/opengraph-image.tsx.
  openGraph: {
    type: "website",
    siteName: "lurq",
    url: "/",
    title: TITLE,
    description: DESCRIPTION,
  },
  twitter: {
    card: "summary_large_image",
    title: TITLE,
    description: DESCRIPTION,
  },
};

/**
 * The browser's own chrome, told what this site is.
 *
 * Without `colorScheme: "dark"` the UA paints form controls, scrollbars and the
 * overscroll gutter from the light palette on a page that is forced dark, which
 * shows as a white band when you rubber-band the top of the page on iOS. The
 * marketing route's paper surface re-declares `color-scheme: light` for itself
 * in globals.css, so the light page keeps its light controls.
 *
 * `themeColor` matches --ground so the address bar is the page rather than a
 * seam above it. Two entries because the OS bar should follow the OS.
 */
export const viewport: Viewport = {
  colorScheme: "dark",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f8f8f6" },
    { media: "(prefers-color-scheme: dark)", color: "#08080a" },
  ],
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <ClerkProvider
      // Land on the dashboard after auth, from *any* entry point. The
      // /sign-in and /sign-up pages set this too, but flows that don't route
      // through them (Clerk's account portal, a verification link opened in a
      // new tab, an <SignInButton> added later) would otherwise fall back to
      // "/" and dump a brand-new user on the marketing page.
      signUpForceRedirectUrl="/dashboard"
      signInForceRedirectUrl="/dashboard"
      signUpFallbackRedirectUrl="/dashboard"
      signInFallbackRedirectUrl="/dashboard"
      appearance={{
        theme: dark,
        // Site is monochrome: override Clerk's default purple accent so its
        // buttons/links match the white CTA (and kill the purple load flash).
        variables: { colorPrimary: "#fafafa" },
      }}
    >
      <html
        lang="en"
        className={`${geist.variable} ${commitMono.variable} dark h-full antialiased`}
        suppressHydrationWarning
      >
        <body className="flex min-h-full flex-col bg-background text-foreground">
          {/* First focusable thing on every page. Keyboard and screen-reader
              users otherwise tab through the whole nav — a mega-nav on the
              marketing route, a sidebar on the dashboard — before reaching the
              content, on every navigation. Hidden until focused; `.skip-link`
              is in globals.css because the visible state needs a real
              position, not a utility stack. */}
          <a href="#content" className="skip-link">
            Skip to content
          </a>
          <TooltipProvider>{children}</TooltipProvider>
          <Analytics />
          <SpeedInsights />
        </body>
      </html>
    </ClerkProvider>
  );
}
