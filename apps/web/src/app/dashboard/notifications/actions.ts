"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@clerk/nextjs/server";
import { isDemoUser } from "@/lib/demo-data";
import {
  createChannel,
  LurqIssuerError,
  removeChannel,
  testChannel,
  updateChannel,
  updateNotificationPreferences,
  type ChannelKind,
  type ChannelSeverity,
} from "@/lib/lurq-issuer";

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

const KINDS: ChannelKind[] = ["slack", "discord", "teams", "webhook"];
const SEVERITIES: ChannelSeverity[] = ["critical", "high", "moderate", "low"];

type Result<T = object> = ({ ok: true } & T) | { ok: false; error: string };

async function writer(): Promise<string | { error: string }> {
  const { userId } = await auth();
  if (!userId) return { error: "Sign in again." };
  if (await isDemoUser(userId)) return { error: "Demo accounts can’t change channels." };
  return userId;
}

const failure = (err: unknown, fallback: string) => ({
  ok: false as const,
  error: err instanceof LurqIssuerError ? err.message : fallback,
});

/** Add a channel. The API posts a test message before saving anything. */
export async function addChannel(input: {
  kind: ChannelKind;
  url: string;
  label?: string;
  minSeverity: ChannelSeverity;
}): Promise<Result<{ signingSecret?: string }>> {
  const who = await writer();
  if (typeof who !== "string") return { ok: false, ...who };
  if (!KINDS.includes(input.kind) || !SEVERITIES.includes(input.minSeverity) || typeof input.url !== "string") {
    return { ok: false, error: "Pick a channel type and paste its URL." };
  }
  try {
    const { signingSecret } = await createChannel(who, {
      kind: input.kind,
      url: input.url.slice(0, 2000),
      label: typeof input.label === "string" ? input.label.slice(0, 80) : undefined,
      minSeverity: input.minSeverity,
    });
    revalidatePath("/dashboard/notifications");
    return { ok: true, signingSecret };
  } catch (err) {
    return failure(err, "Could not add the channel.");
  }
}

export async function changeChannel(
  id: number,
  patch: { enabled?: boolean; minSeverity?: ChannelSeverity },
): Promise<Result> {
  const who = await writer();
  if (typeof who !== "string") return { ok: false, ...who };
  if (!Number.isInteger(id) || id <= 0) return { ok: false, error: "Unknown channel." };
  if (patch.minSeverity !== undefined && !SEVERITIES.includes(patch.minSeverity)) return { ok: false, error: "Unknown severity." };
  if (patch.enabled !== undefined && typeof patch.enabled !== "boolean") return { ok: false, error: "Invalid change." };
  try {
    await updateChannel(who, id, { enabled: patch.enabled, minSeverity: patch.minSeverity });
    revalidatePath("/dashboard/notifications");
    return { ok: true };
  } catch (err) {
    return failure(err, "Could not update the channel.");
  }
}

export async function sendChannelTest(id: number): Promise<Result> {
  const who = await writer();
  if (typeof who !== "string") return { ok: false, ...who };
  if (!Number.isInteger(id) || id <= 0) return { ok: false, error: "Unknown channel." };
  try {
    const r = await testChannel(who, id);
    revalidatePath("/dashboard/notifications");
    return r.ok ? { ok: true } : { ok: false, error: r.error ?? "The test message was not accepted." };
  } catch (err) {
    return failure(err, "Could not test the channel.");
  }
}

export async function deleteChannel(id: number): Promise<Result> {
  const who = await writer();
  if (typeof who !== "string") return { ok: false, ...who };
  if (!Number.isInteger(id) || id <= 0) return { ok: false, error: "Unknown channel." };
  try {
    await removeChannel(who, id);
    revalidatePath("/dashboard/notifications");
    return { ok: true };
  } catch (err) {
    return failure(err, "Could not remove the channel.");
  }
}
