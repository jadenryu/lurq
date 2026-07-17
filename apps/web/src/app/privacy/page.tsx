import type { Metadata } from "next";
import { PageShell } from "@/components/common/page-shell";
import { Prose } from "@/components/common/prose";

export const metadata: Metadata = {
  title: "Privacy Policy | lurq",
  description: "How lurq handles your data.",
};

export default function PrivacyPage() {
  return (
    <PageShell eyebrow="Legal" title="Privacy Policy">
      <p className="mb-8 text-sm text-muted-foreground/70">
        Last updated: July 16, 2026
      </p>

      <div className="mb-10 rounded-lg border border-dashed border-border bg-card/40 p-4 text-sm text-muted-foreground">
        <strong className="text-foreground">Pre-launch draft.</strong> This
        policy describes what lurq actually collects today. lurq is not yet
        incorporated and this is not legal advice; the operating entity and any
        formal data-protection contacts will be finalized before general
        availability.
      </div>

      <Prose>
        <p>
          This Privacy Policy explains how lurq (&ldquo;lurq&rdquo;,
          &ldquo;we&rdquo;, &ldquo;us&rdquo;, or &ldquo;our&rdquo;) collects,
          uses, and shares information about you when you use the lurq website at{" "}
          <a href="https://lurq.run">lurq.run</a>, the lurq command-line
          interface (&ldquo;CLI&rdquo;), the lurq MCP server, and any related
          services (together, the &ldquo;Services&rdquo;).
        </p>
        <p>
          We built lurq as a tool for developers and collect as little personal
          information as we can to run it. Where we do collect information, this
          policy explains what, why, and what choices you have.
        </p>

        <h2>Information we collect</h2>

        <h3>Information you provide to us</h3>
        <ul>
          <li>
            <strong>Waitlist and contact details.</strong> If you join our
            waitlist, request a demo, or contact us, we collect the email address
            and any message contents you provide.
          </li>
          <li>
            <strong>Account information.</strong> If you create an account, our
            authentication provider (Clerk) collects the email address and
            credentials needed to create and secure it. API keys you generate are
            associated with your account.
          </li>
        </ul>

        <h3>Information collected automatically</h3>
        <ul>
          <li>
            <strong>Website and server logs.</strong> When you access lurq.run or
            our hosted API/MCP endpoints, our infrastructure records standard
            technical information such as your IP address, client type and
            version, request timestamps, and the resources you request. We use
            this to operate, secure, debug, and rate-limit the Services.
          </li>
          <li>
            <strong>Product analytics.</strong> Our website uses PostHog to
            capture aggregate usage such as page views and navigation, so we can
            understand how the site is used and improve it. We do not use this to
            build advertising profiles.
          </li>
          <li>
            <strong>Query data.</strong> When you request a recommendation
            through the website, CLI, or MCP server, we receive the search terms
            or package context you submit and the recommendations returned. We use
            this to return your results and to improve the quality and relevance
            of recommendations. The CLI and MCP server do not send us any separate
            analytics or telemetry beyond the queries needed to serve your
            request.
          </li>
        </ul>

        <h3>What we do not collect</h3>
        <p>
          lurq operates on public package metadata. We do not read your source
          code, and the index itself is built entirely from public signals.
        </p>

        <h2>How we use information</h2>
        <ul>
          <li>
            Provide, operate, and maintain the Services, including returning the
            package recommendations you request;
          </li>
          <li>
            Improve and develop the Services, including the quality and relevance
            of recommendations;
          </li>
          <li>
            Communicate with you — responding to your messages and, if you opted
            in, sending occasional updates about news, products, and services;
          </li>
          <li>
            Protect the Services, our users, and the public — detecting and
            preventing abuse, spam, fraud, and security incidents, and enforcing
            our <a href="/terms">Terms of Service</a>; and
          </li>
          <li>Comply with legal obligations.</li>
        </ul>

        <h2>Legal bases for processing (EEA, UK, and Switzerland)</h2>
        <p>
          If you are in the European Economic Area, the United Kingdom, or
          Switzerland, we process your personal information under these legal
          bases: <strong>consent</strong> (for update emails you sign up for);{" "}
          <strong>legitimate interests</strong> (operating, securing, debugging,
          and improving the Services); <strong>performance of a contract</strong>{" "}
          (providing the Services you request); and{" "}
          <strong>legal obligation</strong> (complying with the law). You can
          withdraw consent at any time.
        </p>

        <h2>How we share information</h2>
        <p>
          We do not sell your personal information. We share it only as described
          here:
        </p>
        <ul>
          <li>
            <strong>Service providers (sub-processors).</strong> We rely on
            trusted third parties to run lurq, including{" "}
            <strong>Clerk</strong> (authentication), <strong>Neon</strong>{" "}
            (database), <strong>Railway</strong> (application hosting),{" "}
            <strong>Resend</strong> (transactional and update email),{" "}
            <strong>Cloudflare</strong> (DNS, email routing, and Turnstile bot
            protection), and <strong>PostHog</strong> (product analytics). They
            process information on our behalf and are bound to protect it.
          </li>
          <li>
            <strong>Legal and safety.</strong> We may disclose information if
            required by law or legal process, or where we believe disclosure is
            reasonably necessary to protect the rights, property, or safety of
            lurq, our users, or the public.
          </li>
          <li>
            <strong>Business transfers.</strong> If lurq is involved in a merger,
            acquisition, financing, or sale of assets, your information may be
            transferred as part of that transaction. We will notify you of any
            change in ownership or use of your personal information.
          </li>
        </ul>

        <h2>Data retention</h2>
        <p>
          We keep personal information only as long as we have a reason to — to
          provide the Services, comply with legal obligations, resolve disputes,
          and enforce our agreements. Server logs and query data are retained for
          a limited period and then deleted or aggregated. Waitlist and contact
          information is kept until you ask us to delete it or it is no longer
          needed.
        </p>

        <h2>Your rights and choices</h2>
        <p>
          Depending on where you live, you may have the right to access, correct,
          delete, restrict, or object to our processing of your personal
          information, the right to data portability, and the right to withdraw
          consent. California residents (CCPA/CPRA) have the right to know,
          access, delete, and correct their personal information and not to be
          discriminated against for exercising those rights; we do not sell or
          &ldquo;share&rdquo; personal information for cross-context behavioral
          advertising. EEA/UK/Swiss residents may lodge a complaint with their
          local data protection authority.
        </p>
        <p>
          To exercise any of these rights, email{" "}
          <a href="mailto:contact@lurq.run">contact@lurq.run</a>. You can also
          unsubscribe from update emails at any time using the link in the email.
        </p>

        <h2>International data transfers</h2>
        <p>
          lurq is operated from the United States, and information is processed
          there and wherever our service providers operate. If you access the
          Services from outside the United States, you understand your information
          will be transferred to and processed in the United States and other
          countries, which may have different data protection laws than your own.
          Where required, we rely on appropriate safeguards for these transfers.
        </p>

        <h2>Security</h2>
        <p>
          We take reasonable technical and organizational measures to protect your
          information. No system is perfectly secure, however, and we cannot
          guarantee absolute security.
        </p>

        <h2>Children&apos;s privacy</h2>
        <p>
          The Services are intended for developers and are not directed to
          children. We do not knowingly collect personal information from children
          under 13 (or the equivalent minimum age in your jurisdiction). If you
          believe a child has provided us with personal information, contact us and
          we will delete it.
        </p>

        <h2>Changes to this policy</h2>
        <p>
          We may update this Privacy Policy from time to time. When we make
          material changes, we will update the &ldquo;Last updated&rdquo; date
          above and, where appropriate, provide additional notice. Your continued
          use of the Services after a change takes effect means you accept the
          updated policy.
        </p>

        <h2>Contact</h2>
        <p>
          Questions about this policy or how we handle your information? Reach us
          at <a href="mailto:contact@lurq.run">contact@lurq.run</a>.
        </p>
      </Prose>
    </PageShell>
  );
}
