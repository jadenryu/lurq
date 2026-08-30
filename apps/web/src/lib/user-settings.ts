import "server-only";
import { cache } from "react";
import { auth, clerkClient } from "@clerk/nextjs/server";
import { RANGES } from "@/components/dashboard/range-tabs";

/**
 * Per-user preferences, stored on the Clerk user.
 *
 * ponytail: no `user_settings` table. These are a handful of scalars belonging
 * to one Clerk user, read on render and written when someone touches a control
 * — which is exactly what `privateMetadata` is, and it costs no migration, no
 * loader, no ownership column and no backfill for existing accounts. It is
 * `private` and not `public` because public metadata is readable from the
 * browser by anyone holding the user object, and none of this needs to be.
 *
 * ponytail: a table when a preference has to be queried across users or read by
 * the backend. Everything here is read by one person's own page render, so
 * nothing needs an index on it. The moment the sync worker needs to know a
 * user's preference, this is the wrong home and it should move.
 */

export interface UserSettings {
  /** Default window for the credits page, in days. */
  defaultRangeDays: number;
}

export const DEFAULT_SETTINGS: UserSettings = { defaultRangeDays: 30 };

/**
 * Validated on the way out, not just on the way in.
 *
 * Metadata is a free-form JSON blob: it survives a shape change in this file, a
 * value written by an older deploy, and anything set by hand in the Clerk
 * dashboard. Anything that isn't a range the UI actually offers is not a
 * preference, it's a 404 waiting to be rendered as a selected tab.
 */
function coerce(raw: unknown): UserSettings {
  const meta = (raw ?? {}) as Record<string, unknown>;
  const days = Number(meta.defaultRangeDays);
  return {
    defaultRangeDays: RANGES.some((r) => r.days === days) ? days : DEFAULT_SETTINGS.defaultRangeDays,
  };
}

/**
 * `cache` so a page that reads settings in two places still makes one call to
 * Clerk per request, the same contract the dashboard loaders follow.
 *
 * Never throws. A preference is not worth taking a page down for: a Clerk blip
 * on this call would otherwise 500 the credits page over the question of
 * whether its default tab is 7 or 30 days.
 */
export const loadSettings = cache(async (): Promise<UserSettings> => {
  try {
    const { userId } = await auth();
    if (!userId) return DEFAULT_SETTINGS;
    const client = await clerkClient();
    const user = await client.users.getUser(userId);
    return coerce(user.privateMetadata);
  } catch {
    return DEFAULT_SETTINGS;
  }
});
