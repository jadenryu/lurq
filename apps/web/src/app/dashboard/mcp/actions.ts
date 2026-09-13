"use server";

import { revalidatePath } from "next/cache";
import { currentOwner } from "@/lib/owner";
import { isDemoUser } from "@/lib/demo-data";
import { acknowledgeMcpChange } from "@/lib/lurq-issuer";

/**
 * Acknowledge one MCP server change.
 *
 * A server action is a POST endpoint anyone signed in can call with any body, so
 * the id is validated here and ownership is enforced by the API (the event must
 * belong to this ownerId or it 404s). Demo accounts never write.
 */
export async function acknowledgeChange(eventId: number): Promise<{ ok: boolean }> {
  const owner = await currentOwner();
  if (!owner || !Number.isInteger(eventId) || eventId <= 0) return { ok: false };
  if (await isDemoUser(owner.userId)) return { ok: false };
  try {
    const ok = await acknowledgeMcpChange(owner.ownerId, eventId);
    if (ok) revalidatePath("/dashboard/mcp", "layout");
    return { ok };
  } catch {
    return { ok: false };
  }
}
