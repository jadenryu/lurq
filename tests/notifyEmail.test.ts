/**
 * The Resend and Clerk clients, against a mocked fetch: the request they build
 * and, above all, which failures they call retryable.
 */
import { describe, expect, it, vi } from 'vitest';
import { lookupEmail, sendEmail, SendError } from '../src/notify/email';

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status });
const msg = { to: 'a@example.com', subject: 's', html: '<p>h</p>', text: 't', idempotencyKey: 'urgent:user_1:abc', headers: { 'List-Unsubscribe': '<https://x/u>' } };

describe('sendEmail', () => {
  it('sends with the idempotency key and the unsubscribe headers', async () => {
    const fetchImpl = vi.fn(async () => json(200, { id: 'em_1' }));
    expect(await sendEmail(msg, { apiKey: 're_x', from: 'lurq <alerts@lurq.run>', fetchImpl: fetchImpl as never })).toEqual({ id: 'em_1' });
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://api.resend.com/emails');
    expect((init.headers as Record<string, string>)['Idempotency-Key']).toBe('urgent:user_1:abc');
    expect(JSON.parse(String(init.body))).toMatchObject({ to: ['a@example.com'], headers: { 'List-Unsubscribe': '<https://x/u>' } });
  });

  it.each([
    [429, true],
    [500, true],
    [503, true],
    [422, false],
    [403, false],
  ])('HTTP %i is retryable: %s', async (status, retryable) => {
    const fetchImpl = vi.fn(async () => json(status, { name: 'x' }));
    const err = await sendEmail(msg, { apiKey: 'k', from: 'f', fetchImpl: fetchImpl as never }).catch((e) => e);
    expect(err).toBeInstanceOf(SendError);
    expect((err as SendError).retryable).toBe(retryable);
  });

  it('calls a network failure retryable', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new TypeError('fetch failed');
    });
    const err = (await sendEmail(msg, { apiKey: 'k', from: 'f', fetchImpl: fetchImpl as never }).catch((e) => e)) as SendError;
    expect(err.retryable).toBe(true);
  });
});

describe('lookupEmail', () => {
  const user = (verified: string) => ({
    primary_email_address_id: 'idn_1',
    email_addresses: [
      { id: 'idn_2', email_address: 'old@example.com', verification: { status: 'verified' } },
      { id: 'idn_1', email_address: 'me@example.com', verification: { status: verified } },
    ],
  });

  it('returns the verified primary address', async () => {
    const fetchImpl = vi.fn(async () => json(200, user('verified')));
    expect(await lookupEmail('user_abc', { secretKey: 'sk', fetchImpl: fetchImpl as never })).toBe('me@example.com');
  });

  it('never uses an unverified primary, even when another address is verified', async () => {
    const fetchImpl = vi.fn(async () => json(200, user('unverified')));
    expect(await lookupEmail('user_abc', { secretKey: 'sk', fetchImpl: fetchImpl as never })).toBeNull();
  });

  it('returns null for a missing user or a non-user id, without calling Clerk for the latter', async () => {
    const fetchImpl = vi.fn(async () => json(404, {}));
    expect(await lookupEmail('user_gone', { secretKey: 'sk', fetchImpl: fetchImpl as never })).toBeNull();
    fetchImpl.mockClear();
    expect(await lookupEmail('org_team', { secretKey: 'sk', fetchImpl: fetchImpl as never })).toBeNull();
    expect(await lookupEmail('user_x/../admin', { secretKey: 'sk', fetchImpl: fetchImpl as never })).toBeNull();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('throws a retryable error when Clerk is down', async () => {
    const fetchImpl = vi.fn(async () => json(502, {}));
    const err = (await lookupEmail('user_abc', { secretKey: 'sk', fetchImpl: fetchImpl as never }).catch((e) => e)) as SendError;
    expect(err.retryable).toBe(true);
  });
});
