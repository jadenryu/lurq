/**
 * Section copy for the pricing block. The plans themselves are NOT here.
 *
 * Price, monthly allowance, burst rate and the feature list all live in
 * src/core/plans.ts and are read through the `@lurq/core/*` alias, because the
 * same table is what mcp/http.ts enforces. This file used to carry its own copy
 * of the numbers under a comment admitting they were placeholders nothing
 * checked, which is exactly the drift that arrangement invites.
 *
 * House rules from content/copy.ts apply: sentence case, no em dashes, and the
 * word the hero spends does not get spent again here.
 */

import { GRACE_CALLS_PER_DAY, OVERAGE_CAP_MULTIPLE, PLANS } from "@lurq/core/plans";

export const PRICING_EYEBROW = "Pricing";

export const PRICING_HEAD = "Start free. Pay when it saves you time.";

export const PRICING_BODY =
  "The command line and the installable skill cost nothing and always will. What the paid plans buy is the hosted index: the compatibility graph, the version surfaces, and the crawl that keeps both current.";

/**
 * Under the cards. Answers the question the numbers immediately raise, with the
 * numbers read from core/plans.ts so this cannot drift from what http.ts does
 * past a limit.
 */
const TEAM_OVERAGE = PLANS.team.overageCentsPer1k;
export const PRICING_NOTE =
  "A call is one tool request against the hosted index. The CLI run locally against your own database is unmetered. " +
  `When a plan's monthly calls run out, it keeps ${GRACE_CALLS_PER_DAY} calls a day instead of stopping, until the month turns (UTC).` +
  (TEAM_OVERAGE
    ? ` Monthly Team is the exception: calls past the pool are billed at ${TEAM_OVERAGE / 100} per 1,000, up to ${OVERAGE_CAP_MULTIPLE}x the pool, and the daily grace applies after that. Yearly Team has no overage.`
    : "") +
  " Business is uncapped. The free plan never asks for a card.";

/** Shown on the emphasised card. */
export const PRICING_FEATURED_LABEL = "Most popular";

/** Sits above the feature list on every card except the cheapest. */
export const PRICING_INHERITS = (previous: string) => `Everything in ${previous}, plus`;
