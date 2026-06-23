import { NextResponse } from "next/server";
import { Resend } from "resend";

const TO_EMAIL = process.env.CONTACT_TO_EMAIL ?? "jadenryu@gmail.com";
// Resend requires a verified sender; onboarding@resend.dev works for testing.
const FROM_EMAIL =
  process.env.CONTACT_FROM_EMAIL ?? "lurq contact <onboarding@resend.dev>";

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

  const name = String(body.name ?? "").trim().slice(0, 200);
  const email = String(body.email ?? "").trim().slice(0, 200);
  const message = String(body.message ?? "").trim().slice(0, 5000);
  const company = String(body.company ?? "").trim(); // honeypot
  const token = String(body.token ?? "");

  // Honeypot: real users never fill the hidden "company" field. Return a fake
  // success so bots don't learn they were caught.
  if (company !== "") {
    return NextResponse.json({ ok: true });
  }

  if (!EMAIL_RE.test(email) || message.length === 0) {
    return NextResponse.json(
      { error: "Please enter a valid email and a message." },
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
  if (!apiKey) {
    return NextResponse.json(
      { error: "Email isn't configured yet." },
      { status: 500 },
    );
  }

  const resend = new Resend(apiKey);
  const { error } = await resend.emails.send({
    from: FROM_EMAIL,
    to: TO_EMAIL,
    replyTo: email,
    subject: `lurq contact — ${name || email}`,
    text: `From: ${name || "(no name)"} <${email}>\n\n${message}`,
  });

  if (error) {
    return NextResponse.json(
      { error: "Couldn't send your message. Please try again later." },
      { status: 502 },
    );
  }

  return NextResponse.json({ ok: true });
}
