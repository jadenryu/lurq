/**
 * GitHub App install handshake, web side. Server-only.
 *
 * GitHub echoes the `state` we send back to the callback verbatim. Without
 * binding it to an identity, an attacker could hand a signed-in user a crafted
 * callback URL carrying the *attacker's* installation id and have the victim's
 * account adopt repos they don't own. So state is an HMAC of the Clerk user id
 * under the issuer secret, verified on return — the same secret already trusted
 * as the web↔backend boundary, so this adds no new key to manage.
 */
import { createHmac, timingSafeEqual } from "node:crypto";

function secret(): string {
  const value = process.env.LURQ_ISSUER_SECRET;
  if (!value) throw new Error("LURQ_ISSUER_SECRET is not configured.");
  return value;
}

export function signState(userId: string): string {
  const mac = createHmac("sha256", secret()).update(userId).digest("hex");
  return `${userId}.${mac}`;
}

/** True only when `state` was signed for exactly this user. */
export function verifyState(state: string, userId: string): boolean {
  const separator = state.lastIndexOf(".");
  if (separator <= 0) return false;
  if (state.slice(0, separator) !== userId) return false;
  const presented = Buffer.from(state.slice(separator + 1), "hex");
  const expected = createHmac("sha256", secret()).update(userId).digest();
  return presented.length === expected.length && timingSafeEqual(presented, expected);
}

/** Install URL for the "Connect GitHub" button, or null when unconfigured. */
export function installUrl(userId: string): string | null {
  const slug = process.env.LURQ_GITHUB_APP_SLUG;
  if (!slug || !process.env.LURQ_ISSUER_SECRET) return null;
  const state = encodeURIComponent(signState(userId));
  return `https://github.com/apps/${slug}/installations/new?state=${state}`;
}
