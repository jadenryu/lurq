/**
 * Whether account email can send on this deployment. On its own so the API
 * server can ask without loading the templates (and React) the sender uses.
 */
import { getConfig } from '../core/config';

export function emailConfigured(): boolean {
  const c = getConfig();
  return Boolean(c.RESEND_API_KEY && c.CLERK_SECRET_KEY);
}
