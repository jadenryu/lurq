import { NextResponse } from "next/server";
import { unsubscribeWithToken } from "@/lib/lurq-issuer";

/**
 * Unsubscribe endpoint for account email.
 *
 * Two callers:
 *   - a mail client's one-click unsubscribe (RFC 8058), which POSTs to the URL in
 *     the List-Unsubscribe header with the token in the query string and expects
 *     a 200 — no redirect, no page
 *   - the form on /unsubscribe, which posts the token in the body and expects to
 *     land back on that page
 *
 * GET never unsubscribes; it forwards to the confirmation page, because link
 * scanners fetch every URL in a message.
 */

const TOKEN = /^[A-Za-z0-9_-]{20,100}$/;

function read(token: unknown, kind: unknown): { token: string; kind: "urgent" | "digest" } | null {
  if (typeof token !== "string" || !TOKEN.test(token)) return null;
  if (kind !== "urgent" && kind !== "digest") return null;
  return { token, kind };
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const target = new URL("/unsubscribe", url.origin);
  for (const key of ["token", "kind"]) {
    const v = url.searchParams.get(key);
    if (v) target.searchParams.set(key, v);
  }
  return NextResponse.redirect(target, 303);
}

export async function POST(req: Request) {
  const url = new URL(req.url);

  // One-click: identity is in the query string; the body only says "One-Click".
  const oneClick = read(url.searchParams.get("token"), url.searchParams.get("kind"));
  if (oneClick) {
    try {
      await unsubscribeWithToken(oneClick.token, oneClick.kind);
      return new NextResponse("unsubscribed", { status: 200 });
    } catch {
      return new NextResponse("try again", { status: 502 });
    }
  }

  const form = await req.formData().catch(() => null);
  const fields = read(form?.get("token"), form?.get("kind"));
  const back = new URL("/unsubscribe", url.origin);
  if (!fields) return NextResponse.redirect(back, 303);

  back.searchParams.set("kind", fields.kind);
  try {
    await unsubscribeWithToken(fields.token, fields.kind);
    back.searchParams.set("done", "1");
  } catch {
    back.searchParams.set("token", fields.token);
    back.searchParams.set("error", "1");
  }
  return NextResponse.redirect(back, 303);
}
