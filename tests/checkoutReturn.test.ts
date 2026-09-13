/**
 * Where Stripe sends the browser back to. Backing out of a checkout started in
 * the dashboard used to land on the landing page.
 */
import { describe, expect, it } from 'vitest';
import { checkoutReturnUrls, isCheckoutOrigin } from '../src/billing/stripe';

describe('checkoutReturnUrls', () => {
  it('returns a dashboard checkout to the billing page', () => {
    expect(checkoutReturnUrls('https://lurq.run/', 'dashboard')).toEqual({
      success: 'https://lurq.run/dashboard/billing?checkout={CHECKOUT_SESSION_ID}',
      cancel: 'https://lurq.run/dashboard/billing',
    });
  });

  it('returns a landing page checkout, or one that did not say, to pricing', () => {
    expect(checkoutReturnUrls('https://lurq.run', 'pricing').cancel).toBe('https://lurq.run/#pricing');
    expect(checkoutReturnUrls('https://lurq.run').cancel).toBe('https://lurq.run/#pricing');
  });

  it('accepts only the known origins, never a URL', () => {
    expect(isCheckoutOrigin('dashboard')).toBe(true);
    expect(isCheckoutOrigin('https://evil.example')).toBe(false);
    expect(isCheckoutOrigin(undefined)).toBe(false);
  });
});
