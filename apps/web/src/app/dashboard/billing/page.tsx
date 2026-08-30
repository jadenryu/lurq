import { PageHeader } from "@/components/dashboard/page-header";
import { BillingPanel } from "@/components/dashboard/billing-panel";
import { loadBilling } from "@/lib/dashboard-data";

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
  const [{ data: billing, demo }, searchParams] = await Promise.all([
    loadBilling(),
    props.searchParams,
  ]);
  const justChecked = typeof searchParams.checkout === "string";

  return (
    <div>
      <PageHeader
        title="billing"
        subtitle="Your plan, what it includes, and what you have used this month."
        demo={demo}
      />
      <BillingPanel billing={billing} justCheckedOut={justChecked} />
    </div>
  );
}
