"use client";

import { useEffect } from "react";
import posthog from "posthog-js";

/**
 * The report page's one custom event, so the funnel has a denominator.
 *
 * Pageviews alone cannot answer the question this whole surface was built for:
 * of the people who saw a gated report, how many signed up. That needs the
 * *gated* flag on the view, because a report with nothing behind the blur is
 * not an ask and must not dilute the rate. The click on "Show me the rest" and
 * the /sign-up pageview after it are already autocaptured, so this is the only
 * thing missing, and one event is the whole instrumentation.
 *
 * `repo` is a public GitHub path, which is the point: it tells us which stacks
 * get scanned and shared, and that is the input to deciding what lurq indexes
 * next.
 */
export function ScanSeen({
  repo,
  signedIn,
  gated,
}: {
  repo: string;
  signedIn: boolean;
  gated: number;
}) {
  useEffect(() => {
    posthog.capture("scan_report_view", { repo, signed_in: signedIn, gated_deps: gated });
  }, [repo, signedIn, gated]);

  return null;
}
