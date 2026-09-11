import type { Metadata } from "next";
import Link from "next/link";
import { PageShell } from "@/components/common/page-shell";
import { Prose } from "@/components/common/prose";

export const metadata: Metadata = {
  title: "Security | lurq",
  description:
    "What lurq can and cannot see, how keys and the GitHub App are scoped, and how to report a vulnerability.",
  alternates: { canonical: "/security" },
};

/**
 * The page /.well-known/security.txt points its `Policy:` field at.
 *
 * Two jobs, and they are the same job: a researcher needs somewhere to send a
 * finding, and a developer about to wire an MCP server into their editor needs
 * to know what that server can reach. Both are answered by stating the actual
 * boundary rather than a posture.
 *
 * EVERY CLAIM HERE IS ONE THE CODE ENFORCES. No SOC 2 badge, no "bank-grade",
 * no compliance language for controls that do not exist yet — the "what we do
 * not have yet" section is load-bearing. A trust page that overstates is worth
 * less than no trust page, because the first thing a careful reader does is
 * check one claim.
 */

/** The scopes table: what the GitHub App may do, and what it may never do. */
const GITHUB_SCOPES = [
  {
    scope: "Contents: read-only",
    what: "Read manifests and lockfiles to compute drift.",
    never: "Cannot push, open a PR, or write a file.",
  },
  {
    scope: "Metadata: read-only",
    what: "Resolve repository names and default branches. Mandatory for every GitHub App.",
    never: "Cannot change any setting.",
  },
  {
    scope: "No write scope of any kind",
    what: "Every write in the upgrade loop uses your own GITHUB_TOKEN, inside your own runner.",
    never: "Revoking is `git rm .github/workflows/lurq-upgrade.yml`.",
  },
];

export default function SecurityPage() {
  return (
    <PageShell
      eyebrow="Trust"
      title="Security"
      lead="lurq runs inside your editor and your CI. This is the boundary it operates behind, stated precisely enough to check."
    >
      <Prose>
        <h2 id="what-we-never-see">What lurq never receives</h2>
        <p>
          lurq answers questions about <strong>packages</strong>, not about your
          code. The distinction is architectural, not a policy we promise to
          follow:
        </p>
        <ul>
          <li>
            <strong>Your source code never leaves your machine.</strong> The MCP
            tools take package names and version ranges. There is no request
            shape that carries a file body.
          </li>
          <li>
            <strong>Upgrade checks run locally.</strong>{" "}
            <code>lurq check-upgrade</code> intersects lurq&rsquo;s surface diff
            with your source on your own runner. lurq is sent the result, which
            is symbol names and counts — never the lines they were found on.
          </li>
          <li>
            <strong>No database credentials touch your machine.</strong> lurq is
            a hosted index; setup writes an API key and an HTTPS endpoint, and
            nothing else.
          </li>
        </ul>

        <h2 id="keys">API keys</h2>
        <ul>
          <li>
            Keys are stored hashed. The dashboard shows a six-character prefix so
            you can tell two keys apart; the body is shown once, at creation.
          </li>
          <li>
            Setup copies your key into each agent&rsquo;s MCP config, so{" "}
            <code>lurq logout</code> clears only the CLI&rsquo;s copy. To
            invalidate a key everywhere, revoke it from{" "}
            <Link href="/dashboard/keys">the dashboard</Link> — that takes effect on the
            server, regardless of what is still written on disk.
          </li>
          <li>
            Every authenticated request is rate limited per key, and every
            response carries standard <code>RateLimit-*</code> headers so an
            agent can back off correctly instead of retrying into a wall.
          </li>
        </ul>

        <h2 id="github">The GitHub App</h2>
        <p>
          Autopilot opens pull requests without lurq ever holding write access to
          your repository. It can do that because the writing happens in your CI,
          with your token:
        </p>
      </Prose>

      <div className="mt-6 overflow-hidden rounded-[var(--radius-lg)] border border-border">
        <table className="w-full border-collapse text-left text-[13px]">
          <thead>
            <tr className="border-b border-border bg-card/60">
              <th className="px-4 py-2.5 font-mono text-[11px] uppercase tracking-[0.07em] text-muted-foreground">
                Permission
              </th>
              <th className="px-4 py-2.5 font-mono text-[11px] uppercase tracking-[0.07em] text-muted-foreground">
                What it is for
              </th>
              <th className="px-4 py-2.5 font-mono text-[11px] uppercase tracking-[0.07em] text-muted-foreground">
                What it cannot do
              </th>
            </tr>
          </thead>
          <tbody>
            {GITHUB_SCOPES.map((row) => (
              <tr key={row.scope} className="border-b border-border last:border-0">
                <td className="px-4 py-3 align-top font-mono text-[12.5px] text-foreground">
                  {row.scope}
                </td>
                <td className="px-4 py-3 align-top text-muted-foreground">{row.what}</td>
                <td className="px-4 py-3 align-top text-muted-foreground">{row.never}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <Prose className="mt-10">
        <p>
          The rewriting agent in that workflow runs under a fixed allowlist —{" "}
          <code>Read</code>, <code>Edit</code>, <code>Write</code>, and{" "}
          <code>Bash</code> limited to your package manager. It cannot touch
          version control, so it cannot push a branch, amend history, or change a
          workflow file, including its own.
        </p>

        <h2 id="transport">Transport and browser hardening</h2>
        <ul>
          <li>
            HTTPS only, with HSTS (<code>max-age</code> two years, including
            subdomains) on every response from this site and the API.
          </li>
          <li>
            <code>X-Content-Type-Options: nosniff</code>,{" "}
            <code>X-Frame-Options: DENY</code>,{" "}
            <code>Referrer-Policy: strict-origin-when-cross-origin</code>, and a{" "}
            <code>Permissions-Policy</code> that denies camera, microphone,
            geolocation, payment, USB and ad topics — none of which this site has
            any use for.
          </li>
          <li>
            The API server is fronted by helmet, a per-IP limiter ahead of
            authentication, and a per-key limiter behind it.
          </li>
        </ul>

        <h2 id="reporting">Reporting a vulnerability</h2>
        <p>
          Email <a href="mailto:contact@lurq.run">contact@lurq.run</a> with{" "}
          <code>[security]</code> in the subject. Include what you found, how to
          reproduce it, and what it lets an attacker do.
        </p>
        <ul>
          <li>
            <strong>We respond within 3 business days</strong> to acknowledge, and
            aim to have a fix or a timeline within 14.
          </li>
          <li>
            Please give us 90 days before public disclosure, and do not access or
            modify data belonging to anyone else while testing.
          </li>
          <li>
            Good-faith research reported this way will not be met with legal
            action. There is no paid bounty today; there is credit, below, if you
            want it.
          </li>
        </ul>
        <p>
          Machine-readable version:{" "}
          <a href="/.well-known/security.txt">/.well-known/security.txt</a>.
        </p>

        <h2 id="acknowledgments">Acknowledgments</h2>
        <p>
          Researchers who have reported a valid issue are credited here with their
          permission. The list is empty so far.
        </p>

        <h2 id="not-yet">What lurq does not have yet</h2>
        <p>
          Stated plainly, because finding this out during procurement instead of
          here helps nobody:
        </p>
        <ul>
          <li>
            <strong>No SOC 2 report.</strong> lurq is operated by an individual.
            The controls above are real; the audit that would attest to them has
            not been run.
          </li>
          <li>
            <strong>No Content-Security-Policy on the web app yet.</strong> A
            correct one has to be rolled out in report-only mode first, and that
            work is queued rather than done.
          </li>
          <li>
            <strong>No public status page yet.</strong> Incidents affecting the
            API are announced by email to affected accounts in the meantime.
          </li>
        </ul>
        <p>
          If one of these blocks an evaluation,{" "}
          <Link href="/book-demo">tell us which one</Link> — that is the signal that
          moves it up the list.
        </p>
      </Prose>
    </PageShell>
  );
}
