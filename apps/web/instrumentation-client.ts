// PostHog (product analytics). Next.js 15.3+ auto-loads this file on the client.
// The `defaults` pin turns on autocapture of pageviews + pageleaves, so no
// PostHogProvider or manual PostHogPageView component is needed.
// api_host is the first-party reverse proxy (see rewrites in next.config.ts) so
// ad-blockers don't drop events; ui_host lets the toolbar launch from PostHog.
import posthog from "posthog-js";

const key = process.env.NEXT_PUBLIC_POSTHOG_KEY;

if (key) {
  posthog.init(key, {
    api_host: "/ingest",
    ui_host: "https://us.posthog.com",
    defaults: "2025-05-24",
  });
}
