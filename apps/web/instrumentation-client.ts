// PostHog (product analytics). Next.js 15.3+ auto-loads this file on the client.
// The `defaults` pin turns on autocapture of pageviews + pageleaves, so no
// PostHogProvider or manual PostHogPageView component is needed.
// ponytail: no reverse proxy — add one (next.config rewrites + middleware) only
// if ad-blocker request loss becomes measurable.
import posthog from "posthog-js";

const key = process.env.NEXT_PUBLIC_POSTHOG_KEY;

if (key) {
  posthog.init(key, {
    api_host: process.env.NEXT_PUBLIC_POSTHOG_HOST ?? "https://us.i.posthog.com",
    defaults: "2025-05-24",
  });
}
