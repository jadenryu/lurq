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
        Last updated: June 23, 2026
      </p>

      <div className="mb-10 rounded-lg border border-dashed border-border bg-card/40 p-4 text-sm text-muted-foreground">
        <strong className="text-foreground">Placeholder.</strong> These are
        template terms and not yet legal advice. They will be replaced with
        reviewed terms before general availability.
      </div>

      <Prose>
        <p>
          By accessing or using lurq, you agree to these Terms of Service. If you
          do not agree, do not use the service.
        </p>

        <h2>Use of the service</h2>
        <p>
          lurq provides package recommendations and related tooling for
          informational purposes. You are responsible for evaluating and testing
          any dependency before using it in production.
        </p>

        <h2>The software</h2>
        <p>
          The lurq software is open source under the Apache License 2.0. Your use
          of the source code is governed by that{" "}
          <a href="/license">license</a>.
        </p>

        <h2>Acceptable use</h2>
        <ul>
          <li>Do not abuse, overload, or attempt to disrupt the service.</li>
          <li>Do not use lurq for unlawful purposes.</li>
          <li>
            Do not misrepresent lurq&apos;s output as a guarantee of a
            package&apos;s safety or fitness.
          </li>
        </ul>

        <h2>No warranty</h2>
        <p>
          The service is provided <strong>as is</strong>, without warranties of
          any kind. Recommendations are derived from public signals and may be
          incomplete or out of date. lurq is not liable for decisions made based
          on its output.
        </p>

        <h2>Changes</h2>
        <p>
          We may update these terms from time to time. Continued use after a
          change constitutes acceptance of the revised terms.
        </p>

        <h2>Contact</h2>
        <p>
          Questions about these terms? Reach us at{" "}
          <a href="mailto:contact@lurq.run">contact@lurq.run</a>.
        </p>
      </Prose>
    </PageShell>
  );
}
