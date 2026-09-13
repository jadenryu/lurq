"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@clerk/nextjs/server";
import { isDemoUser } from "@/lib/demo-data";
import { updateNotificationPreferences } from "@/lib/lurq-issuer";

/**
 * Turn one kind of account email on or off.
 *
 * Validated here, not only in the switch: a server action is a POST endpoint any
 * signed-in user can call with any body. Demo accounts never write.
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
  revalidatePath("/dashboard/notifications");
  revalidatePath("/dashboard/mcp");
  return { ok: true };
}
