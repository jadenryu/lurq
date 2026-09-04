/**
 * Operator-only manual billing (`lurq billing grant|grants|revoke`).
 *
 * For money collected outside Stripe: an invoice, a bank transfer, a hosted
 * payment link with no integration behind it. Collecting and granting are
 * separate problems and only the second one touches this codebase, so these
 * commands do the second and have no opinion about the first.
 *
 * Requires DATABASE_URL — they run where the central DB lives, never on a user's
 * machine.
 */
import { createDb } from '../db/client';
import { grantPlan, isManualGrant, listGrants, revokeGrant } from '../db/subscriptions';
import { PLANS, type Tier } from '../core/plans';
import { bold, detail, dim, green, table } from './format';

/**
 * Capped, because `--months 999` is an open-ended grant wearing a number. Three
 * years is longer than any plausible prepaid term and short enough that a
 * forgotten account eventually surfaces rather than never.
 */
const MAX_MONTHS = 36;

const isoDay = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : '-');

export async function runBillingGrant(
  ownerId: string,
  opts: { tier: string; months: string },
): Promise<void> {
  const tier = opts.tier as Tier;
  if (!PLANS[tier]?.paid) {
    console.error(`Not a paid tier: ${opts.tier}. Try one of: pro, enterprise.`);
    process.exitCode = 1;
    return;
  }

  const months = Number(opts.months);
  if (!Number.isInteger(months) || months < 1 || months > MAX_MONTHS) {
    console.error(`--months must be a whole number from 1 to ${MAX_MONTHS}.`);
    process.exitCode = 1;
    return;
  }

  const { db, close } = createDb({ max: 1 });
  try {
    const result = await grantPlan(db, { ownerId, tier, months });
    if (!result.granted) {
      console.error(`Refused: ${result.reason}.`);
      process.exitCode = 1;
      return;
    }
    console.log(
      [
        bold('Plan granted.'),
        '',
        detail([
          ['account', ownerId],
          ['tier', green(tier)],
          ['lapses', isoDay(result.until)],
        ]),
        '',
        dim('No webhook watches this. Renew or revoke it by hand before it lapses.'),
      ].join('\n'),
    );
  } finally {
    await close();
  }
}

export async function runBillingGrants(opts: { json?: boolean } = {}): Promise<void> {
  const { db, close } = createDb({ max: 1 });
  try {
    const rows = await listGrants(db);
    if (opts.json) {
      console.log(JSON.stringify(rows.map((r) => ({ ...r, manual: isManualGrant(r) }))));
      return;
    }
    if (rows.length === 0) {
      console.log('No manual grants. Issue one with `lurq billing grant <user_id> --months <n>`.');
      return;
    }

    const now = Date.now();
    console.log(
      table(
        ['account', 'tier', 'lapses', 'status'],
        rows.map((r) => {
          const lapsed = r.currentPeriodEnd != null && r.currentPeriodEnd.getTime() <= now;
          return [
            r.ownerId,
            r.tier,
            isoDay(r.currentPeriodEnd),
            r.status === 'canceled' ? dim('revoked') : lapsed ? dim('lapsed') : green('active'),
          ];
        }),
      ),
    );
  } finally {
    await close();
  }
}

export async function runBillingRevoke(ownerId: string): Promise<void> {
  const { db, close } = createDb({ max: 1 });
  try {
    const result = await revokeGrant(db, ownerId);
    if (!result.revoked) {
      console.error(`Refused: ${result.reason}.`);
      process.exitCode = 1;
      return;
    }
    console.log(`Grant for ${ownerId} ended. The account drops to free on its next call.`);
  } finally {
    await close();
  }
}
