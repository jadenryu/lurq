"use server";

import { revalidatePath } from "next/cache";
import { auth, clerkClient } from "@clerk/nextjs/server";
import { RANGES } from "@/components/dashboard/range-tabs";
import { isDemoUser } from "@/lib/demo-data";
import { updateNotificationPreferences } from "@/lib/lurq-issuer";

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

/**
 * Turn one kind of account email on or off.
 *
 * Validated here for the same reason as the range: a server action accepts any
 * body. Demo accounts never write.
 */
export async function setNotificationPreference(
  key: "urgentEmail" | "weeklyDigest",
  enabled: boolean,
): Promise<{ ok: boolean }> {
  const { userId } = await auth();
  if (!userId || (key !== "urgentEmail" && key !== "weeklyDigest") || typeof enabled !== "boolean") {
    return { ok: false };
  }
  if (await isDemoUser(userId)) return { ok: false };
  try {
    await updateNotificationPreferences(userId, { [key]: enabled });
  } catch {
    return { ok: false };
  }
  revalidatePath("/dashboard/preferences");
  revalidatePath("/dashboard/notifications");
  return { ok: true };
}
