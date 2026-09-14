"use client";

/**
 * Last resort: a throw in the root layout itself (ClerkProvider included), which
 * no error.tsx can catch because they all render inside it. It replaces the root
 * layout, so it brings its own <html>, <body> and styles.
 */

import "./globals.css";
import "./styles/tokens.css";

export default function GlobalError({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  return (
    <html lang="en" className="dark h-full antialiased">
      <body className="flex min-h-full flex-col items-center justify-center gap-5 bg-background px-4 text-center text-foreground">
        <h1 className="text-xl font-semibold">lurq didn&apos;t load.</h1>
        <p className="max-w-sm text-sm text-muted-foreground">Usually a brief hiccup. Try again.</p>
        <button
          type="button"
          onClick={retry}
          className="rounded-md bg-foreground px-4 py-2 text-sm font-medium text-background"
        >
          Try again
        </button>
        {error.digest ? (
          <p className="font-mono text-[11px] text-muted-foreground/70">Reference {error.digest}</p>
        ) : null}
      </body>
    </html>
  );
}
