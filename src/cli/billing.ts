/**
 * Operator commands for hand-granted plans.
 *
 * These exist so the first paying customers can be served before any payment
 * processor is wired up. They pay however you agreed — invoice, hosted checkout
 * link, bank transfer — and this writes the entitlement. `entitlementFor` reads
 * `tier` and `status` and has no opinion about who collected the money, so a
 * granted account is indistinguishable from a subscribed one at request time.
 */
import { createDb } from '../db/client';
import { PLANS, type Tier } from '../core/plans';
import { grantPlan, listGrants, revokePlan } from '../db/subscriptions';

function parseTier(raw: string): Tier {
  const tier = raw.trim().toLowerCase() as Tier;
  if (!(tier in PLANS) || !PLANS[tier].paid) {
    throw new Error(
      `Unknown or unpayable tier "${raw}". Payable tiers: ${Object.values(PLANS)
        .filter((p) => p.paid)
        .map((p) => p.tier)
        .join(', ')}.`,
    );
  }
  return tier;
}

/** Whole months out from today, clamped so a typo cannot grant a decade. */
function endDate(months: string): Date {
  const n = Number(months);
  if (!Number.isFinite(n) || n < 1 || n > 36) {
    throw new Error(`--months must be between 1 and 36, got "${months}".`);
  }
  const d = new Date();
  d.setMonth(d.getMonth() + Math.floor(n));
  return d;
}

const day = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : '—');

export async function runBillingGrant(
  ownerId: string,
  opts: { tier: string; months: string; note?: string },
): Promise<void> {
  const tier = parseTier(opts.tier);
  const until = endDate(opts.months);
  const { db, close } = createDb({ max: 2 });
  try {
    await grantPlan(db, ownerId.trim(), { tier, until, note: opts.note ?? null });
    console.log(`Granted ${PLANS[tier].name} to ${ownerId} until ${day(until)}.`);
    console.log(
      `It lapses on that date on its own. Re-run this to extend, or ` +
        `\`billing revoke ${ownerId}\` to end it now.`,
    );
  } finally {
    await close();
  }
}

export async function runBillingRevoke(ownerId: string): Promise<void> {
  const { db, close } = createDb({ max: 2 });
  try {
    const found = await revokePlan(db, ownerId.trim());
    console.log(
      found
        ? `${ownerId} is back on the free plan.`
        : `No subscription row for ${ownerId}; nothing to revoke.`,
    );
  } finally {
    await close();
  }
}

export async function runBillingGrants(): Promise<void> {
  const { db, close } = createDb({ max: 2 });
  try {
    const rows = await listGrants(db);
    if (rows.length === 0) {
      console.log('No hand-granted plans.');
      return;
    }
    const now = Date.now();
    for (const r of rows) {
      const lapsed = r.currentPeriodEnd !== null && r.currentPeriodEnd.getTime() <= now;
      // Lapsed rows are listed, not hidden. The whole point of the end date is
      // that it is visible when it passes, so it can be renewed or chased.
      console.log(
        [
          lapsed ? 'LAPSED ' : 'active ',
          r.tier.padEnd(11),
          day(r.currentPeriodEnd).padEnd(12),
          r.ownerId,
          r.manualNote ? `  (${r.manualNote})` : '',
        ].join(''),
      );
    }
  } finally {
    await close();
  }
}
