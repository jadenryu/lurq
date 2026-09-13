import type { Metadata } from "next";
import { PageShell } from "@/components/common/page-shell";
import { Prose } from "@/components/common/prose";

export const metadata: Metadata = {
  title: "Privacy Policy | lurq",
  description: "How lurq handles your data.",
};

/**
 * Every claim on this page is meant to be checkable against the code, and the
 * comments below say where. If you change what a flow collects, sends, or keeps,
 * change the matching paragraph in the same commit.
 */
export default function PrivacyPage() {
  return (
    <PageShell eyebrow="Legal" title="Privacy Policy">
      <p className="mb-8 text-sm text-muted-foreground/70">
        Last updated: September 13, 2026
      </p>

      <div className="mb-10 rounded-lg border border-dashed border-border bg-card/40 p-4 text-sm text-muted-foreground">
        <strong className="text-foreground">Note.</strong> This policy describes
        what lurq actually collects today. lurq is currently operated by an
        individual and this is not legal advice; it will be revisited if and when
        lurq is incorporated as a company.
      </div>

      <Prose>
        <p>
          This Privacy Policy explains how lurq, operated by Jaden Ryu, an
          individual based in the Commonwealth of Virginia (&ldquo;lurq&rdquo;,
          &ldquo;we&rdquo;, &ldquo;us&rdquo;, or &ldquo;our&rdquo;), collects,
          uses, and shares information about you when you use the lurq website at{" "}
          <a href="https://lurq.run">lurq.run</a>, the lurq command-line
          interface (&ldquo;CLI&rdquo;), the lurq MCP server, the lurq GitHub App,
          and any related services (together, the &ldquo;Services&rdquo;).
        </p>
        <p>
          We built lurq as a tool for developers and collect as little personal
          information as we can to run it. Where we do collect information, this
          policy explains what, why, and what choices you have.
        </p>

        <h2>Information we collect</h2>

        <h3>Information you provide to us</h3>
        <ul>
          {/* apps/web/src/app/api/contact/route.ts */}
          <li>
            <strong>Contact messages.</strong> If you use the contact form, we
            collect the name, email address, and message you enter, along with
            your IP address, approximate country, and browser user agent, which
            are included in the email we receive. The form is protected by
            Cloudflare Turnstile. If you email us directly, we receive whatever
            your email contains.
          </li>
          <li>
            <strong>Account information.</strong> If you create an account, our
            authentication provider (Clerk) collects the email address and
            credentials needed to create and secure it. API keys you generate are
            associated with your account; we store only a one-way hash of each
            key, never the key itself.
          </li>
          {/* src/billing/stripe.ts, apps/web/src/app/api/billing/request/route.ts */}
          <li>
            <strong>Billing.</strong> If you buy a paid plan, Stripe collects your
            payment details and billing address on its own checkout page; we
            never see or store your card number. We store your Stripe customer
            and subscription identifiers, your plan, its status, seat count, and
            renewal date. If you ask to buy a plan while self-serve checkout is
            unavailable, we receive an email with your account identifier and
            the plan you chose.
          </li>
          <li>
            <strong>Account email.</strong> We email your account&rsquo;s verified
            address about urgent changes to the dependencies and MCP servers you
            connect, which is on by default, and a weekly summary only if you turn
            it on. Every email has a link to turn it off. We read the address from
            Clerk when an email is sent and do not keep our own copy, and we record
            which alerts were sent so the same one is never sent twice. If you add
            a Slack, Discord, Teams, or webhook alert channel, we store its URL
            encrypted.
          </li>
        </ul>

        <h3>Information collected automatically</h3>
        <ul>
          <li>
            <strong>Website and server logs.</strong> When you access lurq.run or
            our hosted API/MCP endpoints, our hosting providers record standard
            technical information such as your IP address, client type and
            version, request timestamps, and the resources you request. We use
            this to operate, secure, debug, and rate-limit the Services.
          </li>
          {/* instrumentation-client.ts, components/site/repo-scan.tsx,
              components/dashboard/builder-report.tsx, src/core/analytics.ts */}
          <li>
            <strong>Product analytics.</strong> Our website uses PostHog to
            capture usage such as page views, navigation, and page performance,
            and uses Vercel Web Analytics and Speed Insights for aggregate traffic
            and performance. When you are signed in, PostHog events are linked to
            your account. If you scan a GitHub profile or repository from the
            website, the name you typed and the resulting report&rsquo;s summary
            (the GitHub login and its profile type) are recorded in PostHog. Our
            hosted service also records account-level product events in PostHog,
            such as creating an API key, which lurq tool was called and whether it
            succeeded, and the size and cost of dashboard Ask answers, but never
            the contents of your queries or questions. We do not use this to build
            advertising profiles.
          </li>
          {/* src/mcp/handlers.ts, src/search/recommend.ts, src/mcp/plan.ts */}
          <li>
            <strong>Query data.</strong> When you call a lurq tool through the
            CLI or MCP server, we receive the search terms, package names, or
            package context you submit, and return results. To answer a search,
            its text is sent to our embedding model provider; if you pass a
            document to the <code>plan</code> tool, it may be sent to our language
            model provider to break it into components. Search results are cached
            without being tied to your account. Linked to your account we keep
            daily counts of which tools you called, the packages your selection
            policy blocked or warned about, and any outcomes you report back
            (including the need you described). The CLI and MCP server do not send
            us any separate analytics or telemetry beyond the requests needed to
            serve you.
          </li>
        </ul>

        {/* src/github/manifests.ts, src/github/webhook.ts */}
        <h3>GitHub repositories you connect</h3>
        <p>
          If you install the lurq GitHub App, it has read-only access to the
          repositories you choose, including private ones. Our servers read the
          list of those repositories (name, default branch, and whether each is
          private), the repository&rsquo;s file names (to find manifests and
          detect the package manager), and the dependency sections of its{" "}
          <code>package.json</code> files. We store those dependency lists and
          the scan results. Our servers do not read your source files, lockfiles,
          or commit history. When you remove a repository from the App or
          uninstall it, we delete the data we stored for those repositories.
        </p>
        <p>
          Scanning a public GitHub profile or repository from the website reads
          the same kind of public dependency information through GitHub&rsquo;s
          API.
        </p>

        {/* src/cli/reportRuns.ts, src/cli/mcpScan.ts */}
        <h3>What runs on your machine, and what it sends</h3>
        <ul>
          <li>
            <strong>
              <code>lurq check-upgrade</code>
            </strong>{" "}
            reads your code on your own machine or CI runner to find call sites an
            upgrade would break. Your code is not uploaded. Only if you pass{" "}
            <code>--report</code> does it send us the results: package names and
            versions, severity, the names of affected symbols, the number of call
            sites and the file paths they are in, and the CI run link. File
            contents are never sent.
          </li>
          <li>
            <strong>
              <code>lurq mcp-scan</code>
            </strong>{" "}
            connects, from your machine, to the MCP servers configured in your
            coding agents and reads what each one declares. When an API key is
            configured it uploads that to your account unless you pass{" "}
            <code>--no-upload</code>: each server&rsquo;s name, package name or
            remote address, version, transport, and status, the tool, prompt, and
            resource definitions and instructions the server publishes, and a
            one-way fingerprint of its configuration. The configuration itself,
            including any credentials in it, is not uploaded.
          </li>
        </ul>

        {/* apps/web/src/app/api/ask/route.ts */}
        <h3>Dashboard Ask</h3>
        <p>
          If you use Ask in the dashboard, your question and the data from your
          own account needed to answer it (such as your connected repositories,
          their dependencies, alerts, and usage) are sent to Anthropic to generate
          the answer. We record what each day&rsquo;s questions cost, not the
          questions themselves.
        </p>

        <h2>How we use information</h2>
        <ul>
          <li>
            Provide, operate, and maintain the Services, including returning the
            results you request;
          </li>
          <li>
            Improve and develop the Services, including the quality and relevance
            of recommendations;
          </li>
          <li>
            Communicate with you: responding to your messages and sending the
            account emails described above;
          </li>
          <li>Process payments and manage subscriptions;</li>
          <li>
            Protect the Services, our users, and the public: detecting and
            preventing abuse, spam, fraud, and security incidents, and enforcing
            our <a href="/terms">Terms of Service</a>; and
          </li>
          <li>Comply with legal obligations.</li>
        </ul>

        <h2>Legal bases for processing (EEA, UK, and Switzerland)</h2>
        <p>
          If you are in the European Economic Area, the United Kingdom, or
          Switzerland, we process your personal information under these legal
          bases: <strong>consent</strong> (for the optional weekly summary email);{" "}
          <strong>legitimate interests</strong> (operating, securing, debugging,
          and improving the Services); <strong>performance of a contract</strong>{" "}
          (providing the Services you request, including paid plans); and{" "}
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
            <strong>Service providers (sub-processors).</strong> We rely on third
            parties to run lurq: <strong>Clerk</strong> (authentication),{" "}
            <strong>Stripe</strong> (payments and subscription billing),{" "}
            <strong>Neon</strong> (database), <strong>Railway</strong> (API
            hosting), <strong>Vercel</strong> (website and documentation hosting,
            Web Analytics, and Speed Insights), <strong>GitHub</strong> (the lurq
            GitHub App and repository scans), <strong>Anthropic</strong>{" "}
            (dashboard Ask), our embedding and language model provider (search
            queries and <code>plan</code> documents, as described above),{" "}
            <strong>Resend</strong> (email), <strong>Cloudflare</strong> (DNS,
            email routing, and Turnstile bot protection), and{" "}
            <strong>PostHog</strong> (product analytics). They process information
            on our behalf.
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

        {/* No scheduled deletion job exists. `usage-prune` is a manual operator
            command. Keep this section honest if that changes. */}
        <h2>Data retention</h2>
        <p>
          We do not currently delete account data on a schedule. The information
          linked to your account (API keys, usage counts, reported outcomes,
          policy decisions, connected-repository data, upgrade reports, MCP scan
          history, and billing records) is kept while your account exists and
          until you ask us to delete it. Some of it expires or is removed sooner:
          cached search results expire automatically, and data for a GitHub
          repository is deleted when you remove it from the lurq GitHub App.
          Server and website logs are kept by our hosting providers under their
          own retention periods. Contact messages stay in our email until
          deleted. Stripe keeps payment records as the law requires.
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
          To exercise any of these rights, including deleting your account data,
          email <a href="mailto:contact@lurq.run">contact@lurq.run</a>. You can
          turn off account emails at any time using the link in each email.
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
