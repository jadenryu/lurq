"use client";

import { useEffect } from "react";

// Set NEXT_PUBLIC_CALENDLY_URL to your scheduling link (e.g.
// https://calendly.com/your-handle/demo). Falls back to a placeholder.
const CALENDLY_URL =
  process.env.NEXT_PUBLIC_CALENDLY_URL ?? "https://calendly.com/your-handle/30min";

export function CalendlyEmbed() {
  useEffect(() => {
    const script = document.createElement("script");
    script.src = "https://assets.calendly.com/assets/external/widget.js";
    script.async = true;
    document.body.appendChild(script);
    return () => {
      script.remove();
    };
  }, []);

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
