/**
 * The two network calls account email needs: send through Resend, and read a
 * recipient's verified primary address from Clerk. Plain `fetch`, no SDKs, the
 * same choice analytics made: this ships inside the CLI bundle.
 *
 * Every failure is classified as retryable or not, because the sender's whole
 * reliability story is "retry what might work, never retry what cannot".
 */

export interface OutgoingEmail {
  to: string;
  subject: string;
  html: string;
  text: string;
  headers?: Record<string, string>;
  idempotencyKey: string;
}

export class SendError extends Error {
  constructor(
    message: string,
    readonly retryable: boolean,
    readonly status: number,
  ) {
    super(message);
    this.name = 'SendError';
  }
}

const TIMEOUT_MS = 15_000;

async function timedFetch(fetchImpl: typeof fetch, url: string, init: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  timer.unref?.();
  try {
    return await fetchImpl(url, { ...init, signal: controller.signal });
  } catch (err) {
    throw new SendError(err instanceof Error && err.name === 'AbortError' ? 'timed out' : 'network error', true, 0);
  } finally {
    clearTimeout(timer);
  }
}

export async function sendEmail(
  msg: OutgoingEmail,
  opts: { apiKey: string; from: string; fetchImpl?: typeof fetch },
): Promise<{ id: string }> {
  const res = await timedFetch(opts.fetchImpl ?? fetch, 'https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${opts.apiKey}`,
      'Content-Type': 'application/json',
      'Idempotency-Key': msg.idempotencyKey.slice(0, 256),
    },
    body: JSON.stringify({
      from: opts.from,
      to: [msg.to],
      subject: msg.subject,
      html: msg.html,
      text: msg.text,
      headers: msg.headers,
    }),
  });
  if (res.ok) {
    const body = (await res.json().catch(() => ({}))) as { id?: string };
    return { id: body.id ?? '' };
  }
  const body = (await res.json().catch(() => ({}))) as { message?: string; name?: string };
  // 429 and 5xx may work later; anything else (bad address, unverified domain,
  // bad key) will fail identically on every retry.
  const retryable = res.status === 429 || res.status >= 500;
  throw new SendError(`resend ${res.status}: ${(body.name ?? body.message ?? 'error').slice(0, 120)}`, retryable, res.status);
}

interface ClerkUser {
  primary_email_address_id?: string | null;
  email_addresses?: { id: string; email_address: string; verification?: { status?: string } | null }[];
}

/**
 * The account's verified primary email, or null when there is none to use.
 *
 * Only `user_` ids: an organisation id has no inbox, and guessing one member to
 * receive a team's alerts is a decision for a team setting, not a fallback. An
 * unverified address is never used — emailing an address nobody proved they own
 * is how alerts end up with a stranger.
 */
export async function lookupEmail(
  ownerId: string,
  opts: { secretKey: string; fetchImpl?: typeof fetch },
): Promise<string | null> {
  if (!/^user_[A-Za-z0-9]+$/.test(ownerId)) return null;
  const res = await timedFetch(opts.fetchImpl ?? fetch, `https://api.clerk.com/v1/users/${encodeURIComponent(ownerId)}`, {
    headers: { Authorization: `Bearer ${opts.secretKey}` },
  });
  if (res.status === 404) return null;
  if (!res.ok) throw new SendError(`clerk ${res.status}`, res.status === 429 || res.status >= 500, res.status);
  const user = (await res.json()) as ClerkUser;
  const primary = user.email_addresses?.find((e) => e.id === user.primary_email_address_id);
  if (!primary || primary.verification?.status !== 'verified') return null;
  return primary.email_address;
}
