import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";

/**
 * Self-serve API-key issuance. Clerk authenticates the user here; we resolve
 * their durable identity (org if they have one, else their user id) and ask the
 * backend to mint a key stamped with that `ownerId`. The backend never sees
 * Clerk — it trusts this route via the shared LURQ_ISSUER_SECRET. The plaintext
 * key is returned to the client exactly once and never stored here.
 */
export async function POST() {
  const { userId, orgId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Sign in to generate a key." }, { status: 401 });
  }

  const base = process.env.LURQ_MCP_URL;
  const secret = process.env.LURQ_ISSUER_SECRET;
  if (!base || !secret) {
    return NextResponse.json(
      { error: "Key issuance isn't configured yet." },
      { status: 503 },
    );
  }

  const ownerId = orgId ?? userId;
  try {
    const res = await fetch(`${base.replace(/\/$/, "")}/keys`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${secret}`,
      },
      body: JSON.stringify({ ownerId, label: `web:${ownerId}` }),
    });
    if (!res.ok) {
      return NextResponse.json({ error: "Could not issue a key. Try again." }, { status: 502 });
    }
    const data = (await res.json()) as { key?: string };
    if (!data.key) {
      return NextResponse.json({ error: "Issuer returned no key." }, { status: 502 });
    }
    return NextResponse.json({ key: data.key });
  } catch {
    return NextResponse.json({ error: "Key service unreachable." }, { status: 502 });
  }
}
