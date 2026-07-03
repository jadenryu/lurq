"use client";

import { useEffect } from "react";

// Set NEXT_PUBLIC_CALENDLY_URL to your scheduling link (e.g.
// https://calendly.com/your-handle/demo).
const CALENDLY_URL = process.env.NEXT_PUBLIC_CALENDLY_URL;

export function CalendlyEmbed() {
  useEffect(() => {
    if (!CALENDLY_URL) return;
    const script = document.createElement("script");
    script.src = "https://assets.calendly.com/assets/external/widget.js";
    script.async = true;
    document.body.appendChild(script);
    return () => {
      script.remove();
    };
  }, []);

  // Scheduling link not configured: fail loud with a working fallback instead
  // of rendering a dead widget pointed at a placeholder handle.
  if (!CALENDLY_URL) {
    return (
      <div className="w-full rounded-2xl border border-border p-8 text-center">
        <p className="text-muted-foreground">
          Booking isn&apos;t set up yet. Email{" "}
          <a
            href="mailto:contact@lurq.run?subject=lurq%20demo"
            className="text-foreground underline underline-offset-4"
          >
            contact@lurq.run
          </a>{" "}
          and we&apos;ll set up a time.
        </p>
      </div>
    );
  }

  // Theme params keep the widget on the dark monochrome palette.
  const url = `${CALENDLY_URL}?hide_gdpr_banner=1&background_color=0a0a0a&text_color=fafafa&primary_color=fafafa`;

  return (
    <div
      className="calendly-inline-widget w-full overflow-hidden rounded-2xl border border-border"
      data-url={url}
      style={{ minWidth: "320px", height: "700px" }}
    />
  );
}
