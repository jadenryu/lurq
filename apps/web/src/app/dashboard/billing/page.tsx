import { PageBody, PageHeader } from "@/components/dashboard/page-header";
import { BillingPanel } from "@/components/dashboard/billing-panel";
import { loadBilling } from "@/lib/dashboard-data";
import { currentOwner, syncSeatLimit } from "@/lib/owner";
import { PLANS, type Tier } from "@lurq/core/plans";

/**
 * Plan, allowance spent, and the way out to Stripe.
 *
 * This is where Checkout returns to (`success_url` in billing/stripe.ts carries
 * `?checkout=<session id>`), which is why the panel can be told a purchase just
 * happened. It deliberately does not read that session from Stripe to decide
 * anything: entitlement arrives by webhook, and a page that trusted its own
 * query string would grant a plan to anyone who typed one.
 */
export default async function DashboardBillingPage(props: PageProps<"/dashboard/billing">) {
  const [{ data: billing, demo, failed }, searchParams, owner] = await Promise.all([
    loadBilling(),
    props.searchParams,
    currentOwner(),
  ]);
  const justChecked = typeof searchParams.checkout === "string";
  // Skipped on a failed read: that renders as Free, and syncing Free would lift a
  // paying team's seat cap during an outage.
  if (owner?.orgId && !demo && !failed) {
    await syncSeatLimit(owner.orgId, PLANS[billing.tier as Tier]?.perSeat ? billing.seats : null);
  }

  return (
    <div>
      <PageHeader
        title="billing"
        subtitle="Your plan, what it includes, and what you have used this month."
        demo={demo}
      />
      <PageBody>
        <BillingPanel
          billing={billing}
          justCheckedOut={justChecked}
          canManage={owner?.canManage ?? true}
        />
      </PageBody>
    </div>
  );
}
