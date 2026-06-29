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
        Last updated: June 23, 2026
      </p>

      <div className="mb-10 rounded-lg border border-dashed border-border bg-card/40 p-4 text-sm text-muted-foreground">
        <strong className="text-foreground">Placeholder.</strong> This is a
        template privacy policy and not yet legal advice. It will be replaced
        with a reviewed policy before general availability.
      </div>

      <Prose>
        <p>
          This Privacy Policy explains what information lurq (&ldquo;we&rdquo;,
          &ldquo;us&rdquo;) collects, how we use it, and the choices you have.
        </p>

        <h2>Information we collect</h2>
        <ul>
          <li>
            <strong>Account information</strong>: name and email when you sign
            up or request a demo.
          </li>
          <li>
            <strong>Usage data</strong>: basic, privacy-preserving analytics
            about how the site and product are used.
          </li>
          <li>
            <strong>Queries</strong>: package-recommendation requests sent to
            the lurq service, used to return results and improve scoring.
          </li>
        </ul>

        <h2>What we do not collect</h2>
        <p>
          lurq operates on public package metadata. We do not read your source
          code, and the index itself is built entirely from public signals.
        </p>

        <h2>How we use information</h2>
        <ul>
          <li>To provide and maintain the service.</li>
          <li>To respond to your requests and support inquiries.</li>
          <li>To understand usage and improve recommendations.</li>
        </ul>

        <h2>Sharing</h2>
        <p>
          We do not sell your personal information. We share data only with
          service providers necessary to operate lurq, and only as required to
          provide the service.
        </p>

        <h2>Your choices</h2>
        <p>
          You may request access to, correction of, or deletion of your personal
          information at any time by emailing{" "}
          <a href="mailto:jadenryu@gmail.com">jadenryu@gmail.com</a>.
        </p>

        <h2>Contact</h2>
        <p>
          Questions about this policy? Reach us at{" "}
          <a href="mailto:jadenryu@gmail.com">jadenryu@gmail.com</a>.
        </p>
      </Prose>
    </PageShell>
  );
}
