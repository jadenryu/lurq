"use client";

import { useAuth } from "@clerk/nextjs";
import posthog from "posthog-js";
import { useEffect } from "react";

/**
 * Ties PostHog's anonymous visitor to the Clerk account, so page views before
 * sign-up merge into the same person as the backend's `api_key_created` and
 * `tool_called` events (src/core/analytics.ts keys those by the same user id).
 * Signing out resets, so a shared browser doesn't blend two accounts.
 *
 * `__loaded` is false when NEXT_PUBLIC_POSTHOG_KEY is unset (instrumentation-
 * client.ts skips init), which keeps local dev from warning on every render.
 */
export function PostHogIdentify() {
  const { isLoaded, userId } = useAuth();

  useEffect(() => {
    if (!isLoaded || !posthog.__loaded) return;
    if (userId) {
      if (posthog.get_distinct_id() !== userId) posthog.identify(userId);
    } else if (posthog._isIdentified()) {
      posthog.reset();
    }
  }, [isLoaded, userId]);

  return null;
}
