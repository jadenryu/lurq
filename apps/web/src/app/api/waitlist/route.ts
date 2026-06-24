import { NextResponse } from "next/server";
import { Resend } from "resend";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

async function verifyTurnstile(
  token: string,
  ip: string | null,
): Promise<boolean> {
  const secret = process.env.TURNSTILE_SECRET_KEY;
  if (!secret) return false; // fail closed if not configured
  try {
    const res = await fetch(
      "https://challenges.cloudflare.com/turnstile/v0/siteverify",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          secret,
          response: token,
          remoteip: ip ?? undefined,
        }),
      },
    );
    const data = (await res.json()) as { success?: boolean };
    return data.success === true;
  } catch {
    return false;
  }
}

export async function POST(req: Request) {
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }

  const email = String(body.email ?? "").trim().slice(0, 200);
  const company = String(body.company ?? "").trim(); // honeypot
  const token = String(body.token ?? "");

  // Honeypot: real users never fill the hidden "company" field. Return a fake
  // success so bots don't learn they were caught.
  if (company !== "") {
    return NextResponse.json({ ok: true });
  }

  if (!EMAIL_RE.test(email)) {
    return NextResponse.json(
      { error: "Please enter a valid email." },
      { status: 400 },
    );
  }

  if (!token) {
    return NextResponse.json(
      { error: "Please complete the verification." },
      { status: 400 },
    );
  }

  const ip =
    req.headers.get("CF-Connecting-IP") ??
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    null;

  if (!(await verifyTurnstile(token, ip))) {
    return NextResponse.json(
      { error: "Verification failed. Please try again." },
      { status: 403 },
    );
  }

  const apiKey = process.env.RESEND_API_KEY;
  const audienceId = process.env.RESEND_AUDIENCE_ID;
  if (!apiKey || !audienceId) {
    return NextResponse.json(
      { error: "The waitlist isn't configured yet." },
      { status: 500 },
    );
  }

  const resend = new Resend(apiKey);
  const { error } = await resend.contacts.create({
    email,
    audienceId,
    unsubscribed: false,
  });

  if (error) {
    // Resend treats a re-added email as a conflict — that's a success for us
    // (they're already on the list), so only surface genuine failures.
    const name = (error as { name?: string }).name;
    if (name && name !== "validation_error") {
      return NextResponse.json(
        { error: "Couldn't add you right now. Please try again later." },
        { status: 502 },
      );
    }
  }

  return NextResponse.json({ ok: true });
}
