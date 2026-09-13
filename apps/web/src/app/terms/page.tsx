import type { Metadata } from "next";
import { PageShell } from "@/components/common/page-shell";
import { Prose } from "@/components/common/prose";

export const metadata: Metadata = {
  title: "Terms of Service | lurq",
  description: "The terms that govern your use of lurq.",
};

export default function TermsPage() {
  return (
    <PageShell eyebrow="Legal" title="Terms of Service">
      <p className="mb-8 text-sm text-muted-foreground/70">
        Last updated: September 13, 2026
      </p>

      <div className="mb-10 rounded-lg border border-dashed border-border bg-card/40 p-4 text-sm text-muted-foreground">
        <strong className="text-foreground">Note.</strong> lurq is currently
        operated by an individual and these terms are not legal advice. They will
        be revisited if and when lurq is incorporated as a company.
      </div>

      <Prose>
        <p>
          These Terms of Service (&ldquo;Terms&rdquo;) govern your access to and
          use of the lurq website at{" "}
          <a href="https://lurq.run">lurq.run</a>, the lurq command-line
          interface (&ldquo;CLI&rdquo;), the lurq MCP server, and any related
          services (together, the &ldquo;Services&rdquo;), provided by Jaden Ryu,
          an individual based in the Commonwealth of Virginia (&ldquo;lurq&rdquo;,
          &ldquo;we&rdquo;, &ldquo;us&rdquo;, or &ldquo;our&rdquo;).
        </p>
        <p>
          <strong>
            By accessing or using the Services, you agree to these Terms. If you
            don&apos;t agree, don&apos;t use the Services.
          </strong>
        </p>

        <h2>1. Who may use the Services</h2>
        <p>
          You may use the Services only if you can form a binding contract with
          us and only in compliance with these Terms and all applicable laws. If
          you use the Services on behalf of an organization, you represent that
          you are authorized to accept these Terms on its behalf.
        </p>

        <h2>2. What lurq does</h2>
        <p>
          lurq is a dynamic index that surfaces and recommends npm packages in
          response to queries you submit through the website, CLI, or MCP server.
          Recommendations are generated automatically from data about publicly
          available packages.{" "}
          <strong>
            lurq is an informational and discovery tool. It does not host,
            publish, endorse, audit, or vouch for any recommended package.
          </strong>
        </p>

        <h2>3. Recommendations are provided for information only</h2>
        <ul>
          <li>
            Recommendations are <strong>suggestions, not endorsements or
            professional advice.</strong> We do not represent or warrant that any
            recommended package is secure, free of vulnerabilities or malware,
            actively maintained, correctly licensed, non-infringing, or fit for
            your purpose.
          </li>
          <li>
            <strong>
              You are solely responsible for evaluating any package before using
              it,
            </strong>{" "}
            including reviewing its source code, license, security posture,
            maintenance status, and suitability for your project.
          </li>
          <li>
            You assume all risk arising from your decision to install, depend on,
            or use any package that lurq surfaces.
          </li>
        </ul>

        <h2>4. Third-party packages and content</h2>
        <p>
          Recommended packages are created and owned by their respective authors
          and are governed by their own licenses and terms, not by these Terms.
          lurq has no control over third-party packages and is not responsible
          for their content, licensing, security, availability, or the conduct of
          their authors. Any dealings between you and a third-party package or its
          author are solely between you and that party.
        </p>

        <h2>5. License to use the Services</h2>
        <p>
          Subject to these Terms, we grant you a limited, non-exclusive,
          non-transferable, revocable license to access and use the Services for
          their intended purpose.
        </p>
        <p>
          The lurq CLI is open source under the MIT License. Your use of
          that source code is governed by that <a href="/license">license</a>,
          which controls over these Terms for that software.
        </p>

        <h2>6. Acceptable use</h2>
        <p>When using the Services, you agree not to:</p>
        <ul>
          <li>
            Use the Services for any unlawful purpose or in violation of any
            applicable law or regulation;
          </li>
          <li>
            Access the Services, or scrape, harvest, or bulk-download data,
            through automated means except through interfaces we provide and
            within any published rate limits;
          </li>
          <li>
            Interfere with, disrupt, overload, or attempt to gain unauthorized
            access to the Services or their infrastructure;
          </li>
          <li>
            Reverse engineer, decompile, or attempt to derive the source code of
            any hosted or proprietary component of the Services (except to the
            extent this restriction is prohibited by law or permitted by an
            applicable open-source license);
          </li>
          <li>
            Resell, redistribute, or commercially exploit the Services or their
            output without our permission; or
          </li>
          <li>
            Use the Services to build or train a competing index or dataset, or
            to transmit malware, spam, or other harmful content.
          </li>
        </ul>
        <p>
          We may set and enforce rate limits and other usage limits, and may
          throttle, suspend, or restrict access that we reasonably believe
          violates these Terms or threatens the Services.
        </p>

        <h2>7. Intellectual property</h2>
        <p>
          The Services, including the lurq name, logo, website, and index
          (excluding third-party packages and any separately licensed open-source
          components), are owned by lurq and protected by intellectual property
          laws. Except for the limited license above, these Terms do not grant you
          any right in our intellectual property.
        </p>
        <p>
          You retain any rights you have in the queries and content you submit.
          You grant us a license to use that content as needed to operate and
          improve the Services, consistent with our{" "}
          <a href="/privacy">Privacy Policy</a>.
        </p>

        <h2>8. Accounts</h2>
        <p>
          Some parts of the Services, such as generating an API key from your
          dashboard, require an account. Accounts are managed through our
          authentication provider. You are responsible for keeping your
          credentials and API keys secure and for all activity under your account.
          Notify us promptly of any unauthorized use.
        </p>

        <h2>9. Paid plans and billing</h2>
        <p>
          Some plans (currently Pro and Team) are paid subscriptions. The plans,
          their prices and their limits are described on our{" "}
          <a href="/#pricing">pricing page</a>. By starting a paid plan you
          agree to the following.
        </p>
        <ul>
          <li>
            <strong>Payment processing.</strong> Payments are processed by
            Stripe through Stripe Checkout. We do not receive or store your full
            card details. Stripe&apos;s terms and privacy policy also apply to
            your payment.
          </li>
          <li>
            <strong>Billing period and automatic renewal.</strong> Subscriptions
            are billed in advance, monthly or yearly depending on what you choose
            at checkout, and{" "}
            <strong>
              renew automatically at the end of each period until you cancel
            </strong>
            . You authorize us, through Stripe, to charge your payment method at
            each renewal.
          </li>
          <li>
            <strong>Taxes.</strong> Prices are shown before tax. Applicable sales
            tax, VAT or similar taxes are calculated from your billing details and
            added at checkout and on each invoice.
          </li>
          <li>
            <strong>Usage limits.</strong> Each plan includes a monthly allowance
            of hosted calls, counted per calendar month (UTC). Once it is used,
            the account keeps a small number of calls per day until the month
            turns, and further calls are refused until then, as described on the
            pricing page. The command-line tool run locally against your own
            database is not metered.
          </li>
          <li>
            <strong>Team seats.</strong> Team is billed per seat, with a minimum
            number of seats shown on the pricing page. You choose the seat count
            at checkout and can change it in the billing portal. Changes to seat
            count mid-period may be prorated, as shown by Stripe when you make
            the change.
          </li>
          <li>
            <strong>Team overage.</strong> On a monthly Team subscription, the
            call allowance is pooled across seats, and{" "}
            <strong>
              calls past the pool are billed as usage at the per-1,000-call rate
              shown on the pricing page
            </strong>
            , up to a ceiling of twice the pool in a month. Past that ceiling the
            daily grace applies instead. Overage is reported during the month and
            charged on your next invoice. Yearly Team subscriptions do not bill
            overage.
          </li>
          <li>
            <strong>Cancellation.</strong> You can cancel at any time from the
            billing page of your dashboard, which opens Stripe&apos;s billing
            portal. Cancellation takes effect at the end of the current billing
            period; you keep the paid plan until then, and the account then
            returns to the Free plan. We do not delete your account or data
            because a subscription ends.
          </li>
          <li>
            <strong>Downgrades and plan changes.</strong> Plan changes are made in
            the billing portal. Any credit or charge for a change is calculated by
            Stripe and shown before you confirm. When an account moves to a lower
            plan, the lower plan&apos;s limits apply from then on, including how
            far back the policy decision log can be read. Keys already issued
            keep working.
          </li>
          <li>
            <strong>Refunds.</strong> Except where required by law, fees already
            paid are non-refundable, including for partial billing periods and
            unused calls. If you believe you were charged in error, contact us at{" "}
            <a href="mailto:contact@lurq.run">contact@lurq.run</a> and we will
            review it.
          </li>
          <li>
            <strong>Failed payments.</strong> If a renewal payment fails, Stripe
            will retry it over several days and your plan stays active while it
            does. If payment still cannot be collected, the subscription is
            cancelled and the account returns to the Free plan.
          </li>
          <li>
            <strong>Price changes.</strong> We may change plan prices or limits.
            A price change applies to an existing subscription only from its next
            renewal after we have given you at least 30 days&apos; notice by
            email, and you can cancel before it takes effect.
          </li>
          <li>
            <strong>Business plans.</strong> Business plans are arranged directly
            with us. The price, limits and any service levels are set out in a
            separate order form or agreement, which controls over this section
            where the two conflict.
          </li>
        </ul>

        <h2>10. Disclaimers</h2>
        <p>
          <strong>
            The Services are provided &ldquo;as is&rdquo; and &ldquo;as
            available,&rdquo; without warranties of any kind, whether express,
            implied, or statutory, including any implied warranties of
            merchantability, fitness for a particular purpose, title, and
            non-infringement.
          </strong>{" "}
          We do not warrant that the Services will be uninterrupted, timely,
          secure, error-free, or that recommendations will be accurate, complete,
          or reliable. Some jurisdictions do not allow the exclusion of certain
          warranties, so some of these exclusions may not apply to you.
        </p>

        <h2>11. Limitation of liability</h2>
        <p>
          <strong>
            To the maximum extent permitted by law, lurq and its operators,
            officers, and contributors will not be liable for any indirect,
            incidental, special, consequential, exemplary, or punitive damages, or
            for any loss of profits, data, use, goodwill, or other intangible
            losses, arising out of or relating to your use of (or inability to
            use) the Services or any package recommended through them, even if we
            have been advised of the possibility of such damages.
          </strong>
        </p>
        <p>
          <strong>
            To the maximum extent permitted by law, our total liability for all
            claims relating to the Services will not exceed the greater of (a) the
            amount you paid us to use the Services in the twelve months before the
            claim, or (b) USD $100.
          </strong>
        </p>
        <p>
          Some jurisdictions do not allow certain limitations of liability, so
          some of the above may not apply to you.
        </p>

        <h2>12. Indemnification</h2>
        <p>
          You agree to indemnify and hold harmless lurq and its operators and
          contributors from any claims, damages, liabilities, and expenses
          (including reasonable legal fees) arising out of your use of the
          Services, your violation of these Terms, or your violation of any law or
          third-party right.
        </p>

        <h2>13. Termination</h2>
        <p>
          You may stop using the Services at any time. We may suspend or terminate
          your access to the Services at any time, with or without notice,
          including if we reasonably believe you have violated these Terms.
          If we terminate a paid plan for a reason other than your breach of
          these Terms, we will refund the fees you prepaid for the unused part of
          the billing period.
          Sections that by their nature should survive termination (including
          intellectual property, disclaimers, limitation of liability, and
          indemnification) will survive.
        </p>

        <h2>14. Changes to the Services and these Terms</h2>
        <p>
          We may modify or discontinue the Services, in whole or in part, at any
          time. We may also update these Terms from time to time. When we make
          material changes, we will update the &ldquo;Last updated&rdquo; date
          and, where appropriate, provide additional notice. Your continued use of
          the Services after a change takes effect means you accept the updated
          Terms.
        </p>

        <h2>15. Governing law and disputes</h2>
        <p>
          These Terms are governed by the laws of the Commonwealth of Virginia,
          without regard to its conflict-of-laws rules. You agree that any dispute
          arising out of or relating to these Terms or the Services will be
          resolved exclusively in the state or federal courts located in the
          Commonwealth of Virginia, and you consent to their jurisdiction.
        </p>

        <h2>16. Miscellaneous</h2>
        <p>
          These Terms, together with our <a href="/privacy">Privacy Policy</a>,
          are the entire agreement between you and lurq regarding the Services. If
          any provision is found unenforceable, the rest remain in effect. Our
          failure to enforce a provision is not a waiver. You may not assign these
          Terms without our consent; we may assign them in connection with a
          merger, acquisition, or sale of assets.
        </p>

        <h2>17. Contact</h2>
        <p>
          Questions about these Terms? Reach us at{" "}
          <a href="mailto:contact@lurq.run">contact@lurq.run</a>.
        </p>
      </Prose>
    </PageShell>
  );
}
