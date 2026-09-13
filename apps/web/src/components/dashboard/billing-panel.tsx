"use client";

import { useEffect, useState, type ReactNode } from "react";
import { Chip, Panel, PanelHeader, eyebrow } from "@/components/dashboard/panel";
import { StatRow, StatTile } from "@/components/dashboard/stat-tile";
import { CONTACT_EMAIL } from "@/content/copy";
import type { BillingSummary } from "@/lib/lurq-issuer";
import { cn } from "@/lib/utils";
import {
  ANNUAL_DISCOUNT,
  GRACE_CALLS_PER_DAY,
  PLANS,
  PLAN_LIST,
  annualPriceCents,
  type BillingInterval,
  type Plan,
  type Tier,
} from "@lurq/core/plans";

/**
 * The billing page, laid out the way developer consoles lay theirs out: a
 * summary strip, the month's allowance with when it resets and where it is
 * heading, every plan side by side with this one marked, and the details.
 *
 * Everything a customer can do to their own subscription — change card, switch
 * down, cancel, read invoices — still happens in Stripe's portal, not in a
 * screen here. That is a scope decision, not a shortcut: those flows are where
 * billing bugs live, Stripe already gets proration, tax and dunning right, and
 * re-implementing them buys nothing a customer would notice. Upgrades are the
 * exception because they are a new Checkout, not a change to a subscription.
 */

const DAY_MS = 86_400_000;
const YEARLY_OFF = Math.round(ANNUAL_DISCOUNT * 100);

const dollars = (cents: number) => `$${Math.round(cents / 100).toLocaleString("en-US")}`;

/** Yearly reads as its monthly equivalent, the way buyers compare plans. */
function price(plan: Plan, interval: BillingInterval) {
  const yearly = interval === "year" && plan.paid && !plan.contactOnly;
  return {
    amount: dollars(yearly ? annualPriceCents(plan) / 12 : plan.priceCents),
    unit: plan.perSeat ? "/seat/mo" : "/mo",
    yearly,
  };
}

function allowance(plan: Plan): string {
  if (plan.monthlyCalls === null) return "Uncapped hosted calls";
  const calls = plan.monthlyCalls.toLocaleString("en-US");
  return plan.perSeat ? `${calls} calls per seat, pooled` : `${calls} calls a month`;
}

// UTC throughout, so the server render and the browser agree on every date.
function fmtDate(value: string | number | null, year = true): string | null {
  if (value === null) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime())
    ? null
    : d.toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        ...(year ? { year: "numeric" } : {}),
        timeZone: "UTC",
      });
}

/** The allowance runs by calendar month in UTC. */
function monthWindow(nowIso: string) {
  const now = new Date(nowIso);
  const start = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1);
  const end = Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1);
  return { now: now.getTime(), start, end, daysLeft: Math.max(1, Math.ceil((end - now.getTime()) / DAY_MS)) };
}

/**
 * Where the month is heading. A straight line from the calls so far.
 *
 * ponytail: linear extrapolation, blind to weekday/weekend shape. Held back for
 * the first three days, when a single busy afternoon would read as a crisis.
 */
function forecast(used: number, limit: number | null, nowIso: string): { text: string; warn: boolean } | null {
  const { now, start, end } = monthWindow(nowIso);
  const elapsed = now - start;
  if (limit === null || used === 0 || used >= limit || elapsed < 3 * DAY_MS) return null;
  const projected = Math.round((used / elapsed) * (end - start));
  if (projected <= limit) {
    return { text: `On pace for about ${projected.toLocaleString()} calls by the reset.`, warn: false };
  }
  return {
    text: `At this pace you reach the limit around ${fmtDate(start + (limit / used) * elapsed, false)}.`,
    warn: true,
  };
}

/**
 * What the status line says, in the reader's terms rather than Stripe's.
 *
 * `past_due` gets the softest true wording available. The account is still being
 * served (see SERVED_STATUSES) and the person most likely to read it is someone
 * whose card expired, so the line is a thing to fix rather than an accusation.
 */
function statusLine(b: BillingSummary): { text: string; tone: string } | null {
  if (b.tier === "free") return null;
  if (b.cancelAtPeriodEnd) {
    const end = fmtDate(b.currentPeriodEnd);
    return {
      text: end
        ? `Cancels on ${end}. You keep everything until then.`
        : "Cancels at the end of the period.",
      tone: "text-ink-2",
    };
  }
  switch (b.status) {
    case "past_due":
      return {
        text: "We could not take the last payment. Your plan is still active while Stripe retries.",
        tone: "text-declared",
      };
    case "trialing": {
      const end = fmtDate(b.currentPeriodEnd);
      return { text: end ? `Trial, billing starts ${end}.` : "Trial.", tone: "text-ink-2" };
    }
    case "active": {
      const end = fmtDate(b.currentPeriodEnd);
      const cadence =
        b.interval === "year" ? " Billed yearly." : b.interval === "month" ? " Billed monthly." : "";
      return end ? { text: `Renews ${end}.${cadence}`, tone: "text-ink-3" } : null;
    }
    case "canceled":
      return { text: "Cancelled. You are on the free plan.", tone: "text-ink-2" };
    default:
      return null;
  }
}

/** The fourth tile: the next thing that happens to the subscription. */
function nextEvent(b: BillingSummary, plan: Plan): { label: string; value: string; hint: string } {
  const end = fmtDate(b.currentPeriodEnd, false);
  if (!plan.paid) return { label: "Payment", value: "None", hint: "Free never asks for a card" };
  if (b.cancelAtPeriodEnd) return { label: "Ends", value: end ?? "Period end", hint: "Cancelled, active until then" };
  if (b.status === "past_due") return { label: "Payment", value: "Past due", hint: "Stripe is retrying the card" };
  if (b.status === "trialing") return { label: "Trial ends", value: end ?? "Soon", hint: "Billing starts then" };
  if (!b.interval) return { label: "Billing", value: "Invoiced", hint: "Arranged with lurq" };
  return { label: "Renews", value: end ?? "Active", hint: b.interval === "year" ? "Billed yearly" : "Billed monthly" };
}

/** The month's allowance, as a bar. Uncapped plans get no bar to draw. */
function Allowance({ used, limit, nowIso }: { used: number; limit: number | null; nowIso: string }) {
  const ahead = forecast(used, limit, nowIso);
  if (limit === null) {
    return (
      <p className="text-[13px] text-ink-2">
        {used.toLocaleString()} calls this month, of an uncapped allowance.
      </p>
    );
  }
  const pct = Math.min(100, Math.round((used / limit) * 100));
  // Only the last stretch is coloured. A bar that turns amber at 50% trains
  // people to ignore it well before the number actually matters.
  const tone = pct >= 100 ? "bg-conflict" : pct >= 80 ? "bg-declared" : "bg-ink";
  return (
    <div>
      <div className="flex items-baseline justify-between gap-4">
        <p className="text-[13px] text-ink">
          <span className="font-medium tabular-nums">{used.toLocaleString()}</span>
          <span className="text-ink-3"> / {limit.toLocaleString()} calls</span>
        </p>
        <p className="text-[12px] text-ink-3 tabular-nums">{pct}%</p>
      </div>
      <div
        role="progressbar"
        aria-valuenow={pct}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label="Monthly call allowance used"
        className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-surface-2"
      >
        <div className={`h-full rounded-full ${tone}`} style={{ width: `${pct}%` }} />
      </div>
      {pct >= 100 ? (
        <p className="mt-2 text-[12px] leading-[1.5] text-ink-2">
          Calls are limited to {GRACE_CALLS_PER_DAY} a day until the month turns. Upgrading lifts
          the limit immediately.
        </p>
      ) : ahead ? (
        <p className={cn("mt-2 text-[12px] leading-[1.5]", ahead.warn ? "text-declared" : "text-ink-3")}>
          {ahead.text}
        </p>
      ) : null}
    </div>
  );
}

function IntervalToggle({ value, onChange }: { value: BillingInterval; onChange: (v: BillingInterval) => void }) {
  return (
    <div role="group" aria-label="Billing period" className="inline-flex rounded-full border border-edge p-0.5 text-[12px]">
      {(["month", "year"] as const).map((v) => (
        <button
          key={v}
          type="button"
          aria-pressed={value === v}
          onClick={() => onChange(v)}
          className={cn(
            "rounded-full px-3 py-1 transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-mark",
            value === v ? "bg-ink text-ground" : "text-ink-2 hover:text-ink",
          )}
        >
          {v === "month" ? "Monthly" : `Yearly, ${YEARLY_OFF}% off`}
        </button>
      ))}
    </div>
  );
}

function PlanCard({
  plan,
  current,
  interval,
  children,
}: {
  plan: Plan;
  current: boolean;
  interval: BillingInterval;
  children: ReactNode;
}) {
  const p = price(plan, interval);
  return (
    <div
      className={cn(
        "flex flex-col rounded-[var(--radius-panel)] border p-4",
        current ? "border-edge-lit bg-surface-2" : "border-edge",
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <p className="text-[13px] font-medium tracking-[-0.01em] text-ink">{plan.name}</p>
        {current ? <Chip tone="accent">Current plan</Chip> : null}
      </div>
      <p className="mt-3 flex items-baseline gap-1">
        {plan.priceFrom ? <span className="text-[12px] text-ink-3">from</span> : null}
        <span className="text-[26px] font-medium leading-none tracking-[-0.03em] text-ink tabular-nums">
          {p.amount}
        </span>
        <span className="text-[12px] text-ink-3">{p.unit}</span>
      </p>
      <p className="mt-1.5 min-h-4 text-[11.5px] leading-4 text-ink-3">
        {p.yearly ? "billed yearly" : plan.perSeat ? `${plan.minSeats ?? 1}-seat minimum` : " "}
      </p>
      <p className="mt-3 border-t border-edge pt-3 text-[12.5px] font-medium text-ink">{allowance(plan)}</p>
      <ul className="mt-2.5 flex-1 space-y-1.5">
        {plan.features
          // The allowance already has its own line above.
          .filter((f) => !/\bcalls\b/i.test(f))
          .slice(0, 3)
          .map((f) => (
            <li key={f} className="flex gap-2 text-[12.5px] leading-[1.45] text-ink-2">
              <span aria-hidden className="shrink-0 text-ink-3">
                ✓
              </span>
              <span>{f}</span>
            </li>
          ))}
      </ul>
      <div className="mt-4">{children}</div>
    </div>
  );
}

const BTN =
  "inline-flex w-full items-center justify-center rounded-md px-3 py-2 text-[13px] font-medium transition-[background-color,border-color,color,opacity] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-mark disabled:cursor-not-allowed disabled:opacity-60";
const FILLED = `${BTN} bg-ink text-ground hover:bg-white`;
const OUTLINE = `${BTN} border border-edge text-ink hover:border-ink`;

export function BillingPanel({
  billing,
  justCheckedOut,
  now,
  canManage = true,
  inOrganization = false,
}: {
  billing: BillingSummary;
  justCheckedOut: boolean;
  /** Render time from the server, so dates and the forecast match on hydration. */
  now: string;
  /** False for an organization member who is not an admin. */
  canManage?: boolean;
  /** An organization is active. Per-seat plans can only be bought for one. */
  inOrganization?: boolean;
}) {
  // A tier while its checkout opens, "portal" while the portal does.
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [interval, setInterval] = useState<BillingInterval>(billing.interval === "year" ? "year" : "month");
  // Checkout returns here before the webhook has necessarily landed, so a fresh
  // arrival may still read as Free for a second or two. Refreshing once shortly
  // after arrival is what turns that into "it worked" rather than "did it?".
  const [waiting, setWaiting] = useState(justCheckedOut && billing.tier === "free");

  // Back from Stripe restores this page from the back-forward cache with the
  // buttons still disabled and "Opening checkout…" on screen. Reset them.
  useEffect(() => {
    const restore = (e: PageTransitionEvent) => {
      if (e.persisted) setPending(null);
    };
    window.addEventListener("pageshow", restore);
    return () => window.removeEventListener("pageshow", restore);
  }, []);

  useEffect(() => {
    if (!waiting) return;
    const t = setTimeout(() => {
      setWaiting(false);
      window.location.replace("/dashboard/billing");
    }, 2500);
    return () => clearTimeout(t);
  }, [waiting]);

  const post = async (path: string, key: string, body?: unknown) => {
    setPending(key);
    setError(null);
    try {
      const res = await fetch(path, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body ?? {}),
      });
      const data = (await res.json()) as { url?: string; error?: string };
      if (data.url) {
        window.location.assign(data.url);
        return;
      }
      setError(data.error ?? "Something went wrong.");
    } catch {
      setError("Could not reach the billing service.");
    }
    setPending(null);
  };
  const portal = () => post("/api/billing/portal", "portal");

  const plan = PLANS[billing.tier as Tier] ?? PLANS.free;
  const status = statusLine(billing);
  const month = monthWindow(now);
  const next = nextEvent(billing, plan);
  const rank = PLAN_LIST.indexOf(plan);
  const canPortal = billing.manageable && canManage;

  const action = (p: Plan): ReactNode => {
    if (p.tier === plan.tier) {
      return canPortal && plan.paid ? (
        <button type="button" onClick={portal} disabled={pending !== null} className={OUTLINE}>
          {pending === "portal" ? "Opening…" : "Manage plan"}
        </button>
      ) : (
        <p className="py-2 text-center text-[12px] text-ink-3">You are on this plan</p>
      );
    }
    if (!canManage) return null;
    if (p.contactOnly) {
      return (
        <a href={`mailto:${CONTACT_EMAIL}?subject=${encodeURIComponent(`lurq ${p.name}`)}`} className={OUTLINE}>
          Talk to us
        </a>
      );
    }
    // Moving down is a change to an existing subscription, so it is Stripe's to
    // prorate and schedule, in the portal.
    if (PLAN_LIST.indexOf(p) < rank) {
      return canPortal ? (
        <button type="button" onClick={portal} disabled={pending !== null} className={OUTLINE}>
          Downgrade in Stripe
        </button>
      ) : null;
    }
    // Team's seats are an organization's members; a personal account has none.
    const needsOrg = Boolean(p.perSeat) && !inOrganization;
    return (
      <>
        <button
          type="button"
          onClick={() => post("/api/billing/checkout", p.tier, { tier: p.tier, interval, from: "dashboard" })}
          disabled={pending !== null || !billing.billingEnabled || needsOrg}
          className={FILLED}
        >
          {pending === p.tier ? "Opening checkout…" : `Upgrade to ${p.name}`}
        </button>
        {needsOrg ? (
          <p className="mt-2 text-[11.5px] leading-[1.45] text-ink-3">
            Bought for an organization. Create one from the account switcher in the sidebar, switch to
            it, then upgrade.
          </p>
        ) : null}
      </>
    );
  };

  const faq: [string, string][] = [
    [
      "What counts as a call",
      "One tool request against the hosted index. The CLI run locally against your own database is not metered.",
    ],
    [
      "What happens at the limit",
      `Calls slow to ${GRACE_CALLS_PER_DAY} a day instead of stopping, until the allowance resets on the 1st (UTC).${
        PLANS.team.overageCentsPer1k
          ? ` Monthly Team bills ${dollars(PLANS.team.overageCentsPer1k)} per 1,000 calls past its pool instead.`
          : ""
      }`,
    ],
    [
      "Changing or cancelling",
      "Upgrades apply once Stripe confirms payment. Downgrades and cancellation are in the billing portal, and a cancelled plan stays active until its period ends.",
    ],
    ["Yearly billing", `Paying yearly costs ${YEARLY_OFF}% less than paying monthly, on every self-serve plan.`],
  ];

  return (
    <div className="space-y-6">
      {waiting ? (
        <Panel>
          <p className="text-[13px] text-ink-2">
            Payment received. Waiting for Stripe to confirm your plan, this page will refresh.
          </p>
        </Panel>
      ) : null}

      <StatRow>
        <StatTile
          label="Plan"
          value={plan.name}
          hint={
            plan.paid
              ? `${dollars(billing.interval === "year" ? annualPriceCents(plan) / 12 : plan.priceCents)}${plan.perSeat ? `/seat/mo · ${billing.seats} seats` : "/mo"}`
              : "No card needed"
          }
        />
        <StatTile
          label="Calls this month"
          value={billing.used}
          hint={billing.limit === null ? "Uncapped" : `of ${billing.limit.toLocaleString()}`}
        />
        <StatTile
          label="Allowance resets"
          value={fmtDate(month.end, false) ?? "The 1st"}
          hint={`${month.daysLeft} day${month.daysLeft === 1 ? "" : "s"} left`}
        />
        <StatTile label={next.label} value={next.value} hint={next.hint} />
      </StatRow>

      <Panel>
        <PanelHeader title="this month" trailing={<p className={eyebrow}>resets {fmtDate(month.end, false)}</p>} />
        <Allowance used={billing.used} limit={billing.limit} nowIso={now} />
      </Panel>

      <Panel>
        <PanelHeader title="plans" trailing={<IntervalToggle value={interval} onChange={setInterval} />} />
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {PLAN_LIST.map((p) => (
            <PlanCard key={p.tier} plan={p} current={p.tier === plan.tier} interval={interval}>
              {action(p)}
            </PlanCard>
          ))}
        </div>
        {error ? (
          <p role="alert" className="mt-4 text-[12px] text-conflict">
            {error}
          </p>
        ) : null}
        {!canManage ? (
          <p className="mt-4 text-[12px] text-ink-3">Only an organization admin can change the plan.</p>
        ) : !billing.billingEnabled ? (
          <p className="mt-4 text-[12px] text-ink-3">Checkout is not configured on this deployment yet.</p>
        ) : null}
      </Panel>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Panel>
          <PanelHeader
            title="billing details"
            trailing={
              canPortal ? (
                <button
                  type="button"
                  onClick={portal}
                  disabled={pending !== null}
                  className="rounded-md border border-edge px-3 py-1.5 text-[12px] font-medium text-ink transition-colors hover:border-ink disabled:opacity-60"
                >
                  {pending === "portal" ? "Opening…" : "Manage billing"}
                </button>
              ) : undefined
            }
          />
          <p className={cn("text-[13px]", status?.tone ?? "text-ink-2")}>
            {status?.text ?? (plan.paid ? `${plan.name} is active.` : "You are on the free plan. There is no card on file.")}
          </p>
          {plan.perSeat ? (
            <p className="mt-2 text-[13px] text-ink-2">{billing.seats} seats. Change the count in Manage billing.</p>
          ) : null}
          <p className="mt-4 border-t border-edge pt-4 text-[13px] leading-[1.6] text-ink-2">
            {canPortal
              ? "Payment method, invoices and receipts, tax IDs, and cancellation live in Stripe's billing portal."
              : plan.paid
                ? "Invoices and payment details for this plan are handled with lurq directly."
                : "Invoices, receipts and payment details appear in Stripe's billing portal once you upgrade."}
          </p>
        </Panel>

        <Panel>
          <PanelHeader title="how billing works" />
          <dl className="space-y-3.5">
            {faq.map(([q, a]) => (
              <div key={q}>
                <dt className="text-[13px] font-medium text-ink">{q}</dt>
                <dd className="mt-0.5 text-[13px] leading-[1.6] text-ink-2">{a}</dd>
              </div>
            ))}
          </dl>
        </Panel>
      </div>
    </div>
  );
}
