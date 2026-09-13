import { NextResponse } from 'next/server';
import { currentUser } from '@clerk/nextjs/server';
import { ADMIN_ONLY, currentOwner } from '@/lib/owner';
import { Resend } from 'resend';
import { checkRateLimit, rateLimitHeaders } from '@/lib/rate-limit';
import { PLANS, type Tier } from '@lurq/core/plans';

/**
 * "I want to buy this", for the window before Stripe is switched on.
 *
 * /api/billing/checkout 503s when billing is unconfigured, which is correct but
 * is a dead end for the person clicking. This turns that into a lead: it mails
 * the operator the one fact needed to fulfil it by hand, which is the Clerk
 * owner id that `lurq billing grant` takes as its argument. Collect out of band,
 * paste the command, done.
 *
 * No Turnstile here, unlike /api/contact. That form is open to the internet;
 * this route is behind Clerk, and a signed-in account is a stronger gate than a
 * captcha. Rate limiting is per user rather than per IP for the same reason.
 *
 * Delete this route when checkout works. It is scaffolding for a specific
 * temporary state, not a permanent second way to buy.
 */
const TO_EMAIL = process.env.BILLING_TO_EMAIL ?? 'payments@lurq.run';
// Resend sends from any address on the verified domain; lurq.run is verified.
const FROM_EMAIL = process.env.BILLING_FROM_EMAIL ?? 'lurq <payments@lurq.run>';

export async function POST(request: Request) {
  const owner = await currentOwner();
  if (!owner) {
    return NextResponse.json({ error: 'Sign in first.' }, { status: 401 });
  }

  // The plan belongs to the whole organization, so only an admin may buy or change it.
  if (!owner.canManage) {
    return NextResponse.json({ error: ADMIN_ONLY }, { status: 403 });
  }

  // Low ceiling: this is a human clicking a button, not a polled endpoint. It
  // also caps how much mail one account can put in the operator's inbox.
  const limit = checkRateLimit(`billing:request:${owner.ownerId}`, 3, 3_600_000);
  if (!limit.ok) {
    return NextResponse.json(
      { error: "We already have your request. We'll be in touch shortly." },
      { status: 429, headers: rateLimitHeaders(limit) },
    );
  }

  let tier: Tier = 'pro';
  try {
    const body = (await request.json()) as { tier?: string };
    if (typeof body.tier === 'string') tier = body.tier as Tier;
  } catch {
    // Pro is the cheapest self-serve plan, so it is the sane default.
  }

  const plan = PLANS[tier];
  if (!plan?.paid) {
    return NextResponse.json({ error: "That isn't a paid plan." }, { status: 400 });
  }

  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    // Nothing was recorded, so do not tell them it was. The contact section is
    // still on the page and still works.
    return NextResponse.json({ error: "Email isn't configured yet." }, { status: 500 });
  }

  const user = await currentUser();
  const email = user?.primaryEmailAddress?.emailAddress ?? '(no email on account)';
  const name = [user?.firstName, user?.lastName].filter(Boolean).join(' ') || '(no name)';

  const resend = new Resend(apiKey);
  const { error } = await resend.emails.send({
    from: FROM_EMAIL,
    to: TO_EMAIL,
    ...(user?.primaryEmailAddress?.emailAddress
      ? { replyTo: user.primaryEmailAddress.emailAddress }
      : {}),
    subject: `Plan request: ${plan.name} — ${email}`,
    // Plain text on purpose. This goes to us, not to a customer, and its whole
    // job is to be pasteable into a terminal.
    text: [
      `${name} <${email}> wants ${plan.name} ($${Math.round(plan.priceCents / 100)}${plan.perSeat ? '/seat' : ''}/mo).`,
      '',
      'Invoice them, then grant it:',
      '',
      `  npm run operator -- billing grant ${owner.ownerId} --tier ${tier} --months 12${plan.perSeat ? ` --seats ${plan.minSeats ?? 1}` : ''}`,
      '',
      `account: ${owner.ownerId}`,
      `requested: ${new Date().toISOString()}`,
    ].join('\n'),
  });

  if (error) {
    return NextResponse.json(
      { error: "Couldn't send that. Try the contact form." },
      { status: 502 },
    );
  }

  return NextResponse.json({ ok: true });
}
