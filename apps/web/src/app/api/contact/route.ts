import { NextResponse } from "next/server";
import { Resend } from "resend";
import { rateLimit } from "@/lib/rate-limit";

const TO_EMAIL = process.env.CONTACT_TO_EMAIL ?? "jadenryu@gmail.com";
// Resend sends from any address on a verified domain; lurq.run is verified.
const FROM_EMAIL =
  process.env.CONTACT_FROM_EMAIL ?? "lurq <contact@lurq.run>";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Email images need an absolute, non-redirecting URL (apex lurq.run 308s to www).
const LOGO_URL =
  (process.env.NEXT_PUBLIC_SITE_URL ?? "https://www.lurq.run") +
  "/logos/logo.png";

// User input lands in the email HTML; escape it to prevent injection.
function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

interface Origin {
  ip: string | null;
  country: string | null;
  userAgent: string | null;
}

function renderEmail(
  name: string,
  email: string,
  message: string,
  origin: Origin,
): string {
  const safeName = escapeHtml(name || "(no name given)");
  const safeEmail = escapeHtml(email);
  const safeMessage = escapeHtml(message).replace(/\n/g, "<br />");
  const safeOrigin = escapeHtml(
    `${origin.ip ?? "unknown IP"} · ${origin.country ?? "??"} · ${origin.userAgent ?? "unknown UA"}`,
  );
  return `
  <div style="background:#0a0a0a;padding:32px 16px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
    <div style="max-width:560px;margin:0 auto;background:#141414;border:1px solid #262626;border-radius:14px;overflow:hidden;">
      <div style="padding:22px 28px;border-bottom:1px solid #1f1f1f;">
        <img src="${LOGO_URL}" alt="lurq" width="26" height="26" style="display:inline-block;vertical-align:middle;border:0;" />
        <span style="vertical-align:middle;margin-left:8px;font-size:16px;font-weight:600;letter-spacing:-0.01em;color:#fafafa;">lurq</span>
        <div style="margin-top:10px;font-size:13px;color:#8a8a8a;">New contact form submission</div>
      </div>
      <div style="padding:24px 28px;">
        <table style="width:100%;border-collapse:collapse;font-size:14px;color:#e4e4e7;">
          <tr>
            <td style="padding:5px 0;width:72px;vertical-align:top;color:#8a8a8a;font-family:'SF Mono',ui-monospace,Menlo,monospace;font-size:12px;">name</td>
            <td style="padding:5px 0;font-weight:500;color:#fafafa;">${safeName}</td>
          </tr>
          <tr>
            <td style="padding:5px 0;vertical-align:top;color:#8a8a8a;font-family:'SF Mono',ui-monospace,Menlo,monospace;font-size:12px;">email</td>
            <td style="padding:5px 0;"><a href="mailto:${safeEmail}" style="color:#fafafa;font-weight:500;text-decoration:none;border-bottom:1px solid #3f3f3f;">${safeEmail}</a></td>
          </tr>
        </table>
        <div style="margin-top:18px;padding-top:18px;border-top:1px solid #1f1f1f;">
          <div style="margin-bottom:10px;color:#6b6b6b;font-family:'SF Mono',ui-monospace,Menlo,monospace;font-size:11px;text-transform:uppercase;letter-spacing:0.1em;">Message</div>
          <div style="font-size:14px;line-height:1.65;color:#d4d4d8;">${safeMessage}</div>
        </div>
      </div>
      <div style="padding:14px 28px;border-top:1px solid #1f1f1f;background:#0f0f0f;font-size:12px;color:#6b6b6b;">
        Reply to this email to respond &ndash; it goes straight to ${safeEmail}.
        <div style="margin-top:8px;font-family:'SF Mono',ui-monospace,Menlo,monospace;font-size:11px;color:#5a5a5a;word-break:break-all;">origin: ${safeOrigin}</div>
      </div>
    </div>
  </div>`;
}

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

  // Throttle repeat submissions per IP before spending the Turnstile round-trip.
  if (!rateLimit(`contact:${ip ?? "unknown"}`)) {
    return NextResponse.json(
      { error: "Too many requests. Please try again in a minute." },
      { status: 429 },
    );
  }

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

  const origin: Origin = {
    ip,
    country: req.headers.get("CF-IPCountry"),
    userAgent: req.headers.get("user-agent"),
  };

  const resend = new Resend(apiKey);
  const { error } = await resend.emails.send({
    from: FROM_EMAIL,
    to: TO_EMAIL,
    replyTo: email,
    subject: `New lurq inquiry from ${name || email}`,
    text: `New contact form submission\n\nName: ${name || "(no name given)"}\nEmail: ${email}\n\n${message}\n\n---\norigin: ${origin.ip ?? "unknown IP"} · ${origin.country ?? "??"} · ${origin.userAgent ?? "unknown UA"}`,
    html: renderEmail(name, email, message, origin),
  });

  if (error) {
    return NextResponse.json(
      { error: "Couldn't send your message. Please try again later." },
      { status: 502 },
    );
  }

  return NextResponse.json({ ok: true });
}
