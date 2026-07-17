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
        Last updated: July 16, 2026
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
          The lurq CLI is open source under the Apache License 2.0. Your use of
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

        <h2>9. Disclaimers</h2>
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

        <h2>10. Limitation of liability</h2>
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

        <h2>11. Indemnification</h2>
        <p>
          You agree to indemnify and hold harmless lurq and its operators and
          contributors from any claims, damages, liabilities, and expenses
          (including reasonable legal fees) arising out of your use of the
          Services, your violation of these Terms, or your violation of any law or
          third-party right.
        </p>

        <h2>12. Termination</h2>
        <p>
          You may stop using the Services at any time. We may suspend or terminate
          your access to the Services at any time, with or without notice,
          including if we reasonably believe you have violated these Terms.
          Sections that by their nature should survive termination (including
          intellectual property, disclaimers, limitation of liability, and
          indemnification) will survive.
        </p>

        <h2>13. Changes to the Services and these Terms</h2>
        <p>
          We may modify or discontinue the Services, in whole or in part, at any
          time. We may also update these Terms from time to time. When we make
          material changes, we will update the &ldquo;Last updated&rdquo; date
          and, where appropriate, provide additional notice. Your continued use of
          the Services after a change takes effect means you accept the updated
          Terms.
        </p>

        <h2>14. Governing law and disputes</h2>
        <p>
          These Terms are governed by the laws of the Commonwealth of Virginia,
          without regard to its conflict-of-laws rules. You agree that any dispute
          arising out of or relating to these Terms or the Services will be
          resolved exclusively in the state or federal courts located in the
          Commonwealth of Virginia, and you consent to their jurisdiction.
        </p>

        <h2>15. Miscellaneous</h2>
        <p>
          These Terms, together with our <a href="/privacy">Privacy Policy</a>,
          are the entire agreement between you and lurq regarding the Services. If
          any provision is found unenforceable, the rest remain in effect. Our
          failure to enforce a provision is not a waiver. You may not assign these
          Terms without our consent; we may assign them in connection with a
          merger, acquisition, or sale of assets.
        </p>

        <h2>16. Contact</h2>
        <p>
          Questions about these Terms? Reach us at{" "}
          <a href="mailto:contact@lurq.run">contact@lurq.run</a>.
        </p>
      </Prose>
    </PageShell>
  );
}
