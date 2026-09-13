import { auth, clerkClient } from "@clerk/nextjs/server";

/**
 * Who a signed-in request acts for.
 *
 * With an Active Organization, the lurq account is the organization: its keys,
 * policy, repos, usage and plan are shared by every member, and a Team plan's
 * seats are its members. Without one it is the person, exactly as before, so no
 * existing account's data moves when Organizations are switched on.
 *
 * `canManage` gates what binds everyone in an organization: billing, policy
 * writes, CI policy keys, and revoking or rotating a shared key. A personal
 * account always manages itself. Demo checks stay keyed on `userId`, because a
 * demo account is a person, not an org.
 */
export interface Owner {
  ownerId: string;
  userId: string;
  orgId: string | null;
  canManage: boolean;
}

export async function currentOwner(): Promise<Owner | null> {
  const { userId, orgId, orgRole } = await auth();
  if (!userId) return null;
  return {
    ownerId: orgId ?? userId,
    userId,
    orgId: orgId ?? null,
    canManage: !orgId || orgRole === "org:admin",
  };
}

export const ADMIN_ONLY = "Only an organization admin can do that.";

/**
 * Keep an organization's member cap equal to its Team seats.
 *
 * Clerk enforces the cap when members are invited, so seats are held by the
 * thing that adds members rather than by a check every route would have to
 * remember. Other plans are uncapped (0): their call allowance is the limit that
 * matters, and a Free org of twenty still shares one Free pool.
 *
 * ponytail: runs when the billing page renders, which is where Checkout and the
 * portal return to. A seat change nobody follows back to that page keeps the old
 * cap until someone opens it; move this into the Stripe webhook if that bites.
 */
export async function syncSeatLimit(orgId: string, seats: number | null): Promise<void> {
  const want = seats ?? 0;
  try {
    const client = await clerkClient();
    const org = await client.organizations.getOrganization({ organizationId: orgId });
    if (org.maxAllowedMemberships === want) return;
    await client.organizations.updateOrganization(orgId, { maxAllowedMemberships: want });
  } catch (err) {
    console.warn(
      "[lurq] could not sync the organization seat limit.",
      err instanceof Error ? err.message : String(err),
    );
  }
}
