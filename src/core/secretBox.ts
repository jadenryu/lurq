/**
 * Authenticated encryption for credentials lurq has to use later, not just
 * check: a Slack webhook URL is itself the credential that posts to a channel,
 * so it cannot be hashed like an API key.
 *
 * AES-256-GCM with a random IV per value. The owner id is bound as associated
 * data, so a ciphertext copied onto another account's row fails to open instead
 * of quietly posting that account's alerts somewhere else.
 *
 * ponytail: one key, no rotation. Add a `v2` prefix and a previous-key fallback
 * when the key has to change.
 */
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

/** The key from config, or null when unset. Throws on a malformed one: a bad key must fail loudly at startup, not at the first post. */
export function secretKey(raw: string | undefined): Buffer | null {
  if (!raw) return null;
  const key = Buffer.from(raw, 'base64');
  if (key.length !== 32) {
    throw new Error('LURQ_SECRETS_KEY must be 32 bytes, base64-encoded (openssl rand -base64 32)');
  }
  return key;
}

export function seal(plaintext: string, key: Buffer, context: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(Buffer.from(context, 'utf8'));
  const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  return `v1.${iv.toString('base64url')}.${cipher.getAuthTag().toString('base64url')}.${ct.toString('base64url')}`;
}

export function open(sealed: string, key: Buffer, context: string): string {
  const [version, iv, tag, ct] = sealed.split('.');
  if (version !== 'v1' || !iv || !tag || ct === undefined) throw new Error('not a sealed value');
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'base64url'));
  decipher.setAAD(Buffer.from(context, 'utf8'));
  decipher.setAuthTag(Buffer.from(tag, 'base64url'));
  return Buffer.concat([decipher.update(Buffer.from(ct, 'base64url')), decipher.final()]).toString('utf8');
}
