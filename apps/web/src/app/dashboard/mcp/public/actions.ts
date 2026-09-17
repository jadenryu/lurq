"use server";

import { revalidatePath } from "next/cache";
import { currentOwner } from "@/lib/owner";
import { isDemoUser } from "@/lib/demo-data";
import { acknowledgePublicMcpChange, pinPublicEndpoint, unpinPublicEndpoint } from "@/lib/lurq-issuer";

/**
 * Writes on a public MCP endpoint page. Server actions are POST endpoints any
 * signed-in user can call with any body, so ids are validated here; the API
 * scopes every write to the ownerId it is given. Demo accounts never write.
 */
async function writer(): Promise<string | null> {
  const owner = await currentOwner();
  if (!owner || (await isDemoUser(owner.userId))) return null;
  return owner.ownerId;
}

const validId = (id: number) => Number.isInteger(id) && id > 0;

export async function acknowledgePublicChange(changeId: number, endpointId: number): Promise<{ ok: boolean }> {
  const ownerId = await writer();
  if (!ownerId || !validId(changeId) || !validId(endpointId)) return { ok: false };
  try {
    const ok = await acknowledgePublicMcpChange(ownerId, changeId);
    if (ok) revalidatePath(`/dashboard/mcp/public/${endpointId}`);
    return { ok };
  } catch {
    return { ok: false };
  }
}

export async function setPin(endpointId: number, pinned: boolean): Promise<{ ok: boolean }> {
  const ownerId = await writer();
  if (!ownerId || !validId(endpointId)) return { ok: false };
  try {
    const ok = pinned ? await pinPublicEndpoint(ownerId, endpointId) : await unpinPublicEndpoint(ownerId, endpointId);
    revalidatePath(`/dashboard/mcp/public/${endpointId}`);
    return { ok };
  } catch {
    return { ok: false };
  }
}
