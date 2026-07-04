// Next.js auto-loads this on the client — no provider component needed.
// Events route through the /ingest reverse proxy (next.config.ts) so ad-blockers
// can't drop them. `web_vitals: true` is the client half of web-vitals autocapture;
// the other half is the toggle in PostHog project settings → Web analytics.
import posthog from "posthog-js";

const key = process.env.NEXT_PUBLIC_POSTHOG_KEY;

if (key) {
  posthog.init(key, {
    api_host: "/ingest",
    ui_host: "https://us.posthog.com",
    defaults: "2025-05-24", // history-based pageview + pageleave capture for App Router nav
    capture_performance: { web_vitals: true },
  });
}
