import type { Metadata } from "next";
import { Analytics } from "@vercel/analytics/next";
import { ClerkProvider } from "@clerk/nextjs";
import { dark } from "@clerk/themes";
import { TooltipProvider } from "@/components/ui/tooltip";
import { geist } from "@/lib/fonts";
import "./globals.css";

export const metadata: Metadata = {
  // Canonical base for resolving relative metadata URLs (OG images, etc.).
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL ?? "https://www.lurq.run"),
  title: "lurq | objective package recommendations for AI coding agents",
  description:
    "A continuously-updated, evidence-scored index of JS/TS frameworks and libraries: fresh, objective dependency recommendations for your coding agent.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <ClerkProvider appearance={{ theme: dark }}>
      <html
        lang="en"
        className={`${geist.variable} dark h-full antialiased`}
        suppressHydrationWarning
      >
        <body className="flex min-h-full flex-col bg-background text-foreground">
          <TooltipProvider>{children}</TooltipProvider>
          <Analytics />
        </body>
      </html>
    </ClerkProvider>
  );
}
