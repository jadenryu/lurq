import type { Metadata } from "next";
import { ClerkProvider } from "@clerk/nextjs";
import { dark } from "@clerk/themes";
import { TooltipProvider } from "@/components/ui/tooltip";
import { supreme } from "@/lib/fonts";
import "./globals.css";

export const metadata: Metadata = {
  title: "lurq – objective package recommendations for AI coding agents",
  description:
    "A continuously-updated, evidence-scored index of JS/TS frameworks and libraries – fresh, objective dependency recommendations for your coding agent.",
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
        className={`${supreme.variable} dark h-full antialiased`}
        suppressHydrationWarning
      >
        <body className="flex min-h-full flex-col bg-background text-foreground">
          <TooltipProvider>{children}</TooltipProvider>
        </body>
      </html>
    </ClerkProvider>
  );
}
