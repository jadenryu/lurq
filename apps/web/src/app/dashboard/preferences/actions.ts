"use server";

import { revalidatePath } from "next/cache";
import { auth, clerkClient } from "@clerk/nextjs/server";
import { RANGES } from "@/components/dashboard/range-tabs";

/**
 * The write half of user-settings.ts.
 *
 * Separate file because "use server" marks every export in it as a callable
 * endpoint: putting the writer beside the reader would publish `loadSettings`
 * to the network for no reason.
 *
 * The value is validated here and not only in the form. A server action is a
 * POST endpoint anyone signed in can call with any body — the client control is
 * a convenience, never the check.
 */
export async function setDefaultRange(days: number): Promise<{ ok: boolean }> {
  const { userId } = await auth();
  if (!userId) return { ok: false };
  if (!RANGES.some((r) => r.days === days)) return { ok: false };

  const client = await clerkClient();
  await client.users.updateUserMetadata(userId, {
    privateMetadata: { defaultRangeDays: days },
  });

  // Credits renders its default tab from this, so it is stale now. Activity is
  // deliberately not here: it has no range control and reads the whole feed.
  revalidatePath("/dashboard/usage");
  return { ok: true };
}
