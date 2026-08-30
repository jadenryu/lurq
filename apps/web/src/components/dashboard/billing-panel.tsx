"use client";

import { useEffect, useState } from "react";
import { Panel, PanelHeader, eyebrow } from "@/components/dashboard/panel";
import type { BillingSummary } from "@/lib/lurq-issuer";
import { PLANS, PLAN_LIST, type Tier } from "@lurq/core/plans";

/**
 * The plan, the month's allowance, and one button out to Stripe.
 *
 * Everything a customer can do to their own subscription — change card, switch
 * tier, cancel, read invoices — happens in Stripe's portal, not in a screen
 * here. That is a scope decision, not a shortcut: those flows are where billing
 * bugs live, Stripe already gets proration, tax and dunning right, and
 * re-implementing them buys nothing a customer would notice.
 */

function fmtDate(iso: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? null
    : d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
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
      return end ? { text: `Renews ${end}.`, tone: "text-ink-3" } : null;
    }
    case "canceled":
      return { text: "Cancelled. You are on the free plan.", tone: "text-ink-2" };
    default:
      return null;
  }
}

/** The month's allowance, as a bar. Uncapped plans get no bar to draw. */
function Allowance({ used, limit }: { used: number; limit: number | null }) {
  if (limit === null) {
    return (
      <p className="mt-2 text-[13px] text-ink-2">
        {used.toLocaleString()} calls this month, of an uncapped allowance.
      </p>
    );
  }
  const pct = Math.min(100, Math.round((used / limit) * 100));
  // Only the last stretch is coloured. A bar that turns amber at 50% trains
  // people to ignore it well before the number actually matters.
  const tone = pct >= 100 ? "bg-conflict" : pct >= 80 ? "bg-declared" : "bg-ink";
  return (
    <div className="mt-3">
      <div className="flex items-baseline justify-between gap-4">
        <p className="text-[13px] text-ink">
          <span className="font-medium">{used.toLocaleString()}</span>
          <span className="text-ink-3"> / {limit.toLocaleString()} calls</span>
        </p>
        <p className="text-[12px] text-ink-3">{pct}%</p>
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
          Calls are returning 402 until the month turns. Upgrading lifts the limit immediately.
        </p>
      ) : null}
    </div>
  );
}

const BTN =
  "inline-flex items-center justify-center rounded-md px-4 py-2 text-[13px] font-medium transition-[background-color,border-color,color,opacity] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-mark disabled:cursor-not-allowed disabled:opacity-60";

export function BillingPanel({
  billing,
  justCheckedOut,
}: {
  billing: BillingSummary;
  justCheckedOut: boolean;
}) {
  const [pending, setPending] = useState<"checkout" | "portal" | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Checkout returns here before the webhook has necessarily landed, so a fresh
  // arrival may still read as Free for a second or two. Refreshing once shortly
  // after arrival is what turns that into "it worked" rather than "did it?".
  const [waiting, setWaiting] = useState(justCheckedOut && billing.tier === "free");

  useEffect(() => {
    if (!waiting) return;
    const t = setTimeout(() => {
      setWaiting(false);
      window.location.replace("/dashboard/billing");
    }, 2500);
    return () => clearTimeout(t);
  }, [waiting]);

  const post = async (path: string, kind: "checkout" | "portal", body?: unknown) => {
    setPending(kind);
    setError(null);
    try {
      const res = await fetch(path, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body ?? {}),
      });
      const data = (await res.json()) as { url?: string; error?: string };
      if (data.url) {
        window.location.href = data.url;
        return;
      }
      setError(data.error ?? "Something went wrong.");
    } catch {
      setError("Could not reach the billing service.");
    }
    setPending(null);
  };

  const plan = PLANS[billing.tier as Tier] ?? PLANS.free;
  const status = statusLine(billing);
  const upgrade = PLAN_LIST.find((p) => p.paid && !p.contactOnly && p.tier !== billing.tier);

  return (
    <div className="space-y-6">
      {waiting ? (
        <Panel>
          <p className="text-[13px] text-ink-2">
            Payment received. Waiting for Stripe to confirm your plan, this page will refresh.
          </p>
        </Panel>
      ) : null}

      <Panel>
        <PanelHeader
          title="plan"
          trailing={
            billing.manageable ? (
              <button
                type="button"
                onClick={() => post("/api/billing/portal", "portal")}
                disabled={pending !== null}
                className={`${BTN} border border-edge text-ink hover:border-ink`}
              >
                {pending === "portal" ? "Opening…" : "Manage billing"}
              </button>
            ) : undefined
          }
        />
        <div className="mt-4">
          <p className={eyebrow}>current plan</p>
          <p className="mt-1 font-sans text-[24px] font-medium tracking-[-0.02em] text-ink">
            {plan.name}
          </p>
          <p className="mt-1 text-[13px] leading-[1.6] text-ink-2">{plan.tagline}</p>
          {status ? <p className={`mt-3 text-[13px] ${status.tone}`}>{status.text}</p> : null}
        </div>

        <div className="mt-6 border-t border-edge pt-4">
          <p className={eyebrow}>this month</p>
          <Allowance used={billing.used} limit={billing.limit} />
        </div>

        {error ? (
          <p role="alert" className="mt-4 text-[12px] text-conflict">
            {error}
          </p>
        ) : null}
      </Panel>

      {/* Only shown when there is somewhere to go. An upgrade card on the top
          plan is an advert for something the reader already bought. */}
      {upgrade && billing.tier !== "enterprise" ? (
        <Panel>
          <PanelHeader title={`upgrade to ${upgrade.name.toLowerCase()}`} />
          <p className="mt-3 max-w-[60ch] text-[13px] leading-[1.6] text-ink-2">
            {upgrade.tagline}{" "}
            {upgrade.monthlyCalls === null
              ? "Uncapped hosted calls."
              : `${upgrade.monthlyCalls.toLocaleString()} hosted calls a month.`}
          </p>
          <ul className="mt-4 space-y-2">
            {upgrade.features.slice(0, 4).map((f) => (
              <li key={f} className="flex gap-2.5 text-[13px] leading-[1.5] text-ink-2">
                <span aria-hidden className="mt-[1px] shrink-0 text-ink-3">
                  ✓
                </span>
                <span>{f}</span>
              </li>
            ))}
          </ul>
          <div className="mt-5">
            <button
              type="button"
              onClick={() => post("/api/billing/checkout", "checkout", { tier: upgrade.tier })}
              disabled={pending !== null || !billing.billingEnabled}
              className={`${BTN} bg-ink text-ground hover:bg-white`}
            >
              {pending === "checkout"
                ? "Opening checkout…"
                : `Upgrade for $${Math.round(upgrade.priceCents / 100)}/mo`}
            </button>
            {!billing.billingEnabled ? (
              <p className="mt-2 text-[12px] text-ink-3">
                Checkout is not configured on this deployment yet.
              </p>
            ) : null}
          </div>
        </Panel>
      ) : null}
    </div>
  );
}
