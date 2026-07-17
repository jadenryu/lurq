import type { Metadata } from "next";
import { Analytics } from "@vercel/analytics/next";
import { SpeedInsights } from "@vercel/speed-insights/next";
import { ClerkProvider } from "@clerk/nextjs";
import { dark } from "@clerk/themes";
import { TooltipProvider } from "@/components/ui/tooltip";
import { geist } from "@/lib/fonts";
import { SITE_ORIGIN } from "@/lib/site";
import "./globals.css";

const TITLE = "lurq | objective package recommendations for AI coding agents";
const DESCRIPTION =
  "A continuously-updated, evidence-scored index of JS/TS frameworks and libraries: fresh, objective dependency recommendations for your coding agent.";

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

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <ClerkProvider
      appearance={{
        theme: dark,
        // Site is monochrome — override Clerk's default purple accent so its
        // buttons/links match the white CTA (and kill the purple load flash).
        variables: { colorPrimary: "#fafafa" },
      }}
    >
      <html
        lang="en"
        className={`${geist.variable} dark h-full antialiased`}
        suppressHydrationWarning
      >
        <body className="flex min-h-full flex-col bg-background text-foreground">
          <TooltipProvider>{children}</TooltipProvider>
          <Analytics />
          <SpeedInsights />
        </body>
      </html>
    </ClerkProvider>
  );
}
