import type { Metadata } from "next";
import Link from "next/link";
import { PageShell } from "@/components/common/page-shell";
import { Prose } from "@/components/common/prose";

export const metadata: Metadata = {
  title: "lurq-probe | lurq",
  description:
    "What lurq's MCP probe requests from remote MCP servers, how often, what it never does, and how a maintainer stops it.",
  alternates: { canonical: "/probe" },
};

/**
 * The page the probe's User-Agent points at: `lurq-probe/1 (+https://lurq.run/probe)`.
 *
 * Written for the person who found that string in their access logs. They want
 * three answers fast — what is this, is it safe, how do I stop it — and every
 * claim below is one the code enforces (src/remoteProbe/probe.ts,
 * src/remoteProbe/oauth.ts, src/remoteProbe/schedule.ts, src/core/safeFetch.ts).
 * If the probe starts doing something this page does not say, the page is
 * wrong first and the change is wrong second.
 */
export default function ProbePage() {
  return (
    <PageShell
      eyebrow="Trust"
      title="lurq-probe"
      lead="If lurq-probe/1 is in your logs, lurq read your MCP server the way any MCP client first meets it: without credentials, to tell developers whether it will work in their client."
    >
      <Prose>
        <h2 id="what-it-requests">What it requests</h2>
        <p>Per endpoint, per visit, at most these:</p>
        <ul>
          <li>
            <strong>One <code>tools/list</code> request.</strong> A stateless JSON-RPC call in the 2026-07-28
            protocol revision. Servers on earlier revisions get the standard <code>initialize</code> handshake
            first, then the same <code>tools/list</code>, following <code>nextCursor</code> pages.
          </li>
          <li>
            <strong>OAuth discovery documents, only if the request was refused.</strong> The protected resource
            metadata (<code>/.well-known/oauth-protected-resource</code>, or the URL your{" "}
            <code>WWW-Authenticate</code> header names) and your authorization server&rsquo;s metadata, in the
            order the MCP specification tells clients to try them.
          </li>
        </ul>

        <h2 id="what-it-never-does">What it never does</h2>
        <ul>
          <li>
            <strong>It never calls a tool.</strong> No <code>tools/call</code>, no prompts, no resources read. It
            learns what your server offers, not what your server does.
          </li>
          <li>
            <strong>It never sends a credential.</strong> No API key, no token, no cookie. A server that requires
            one is recorded as requiring one.
          </li>
          <li>
            <strong>It never registers an OAuth client.</strong> Discovery reads your metadata documents; nothing is
            posted to a registration endpoint and no authorization flow is started.
          </li>
          <li>
            <strong>It never reaches a private network.</strong> Only public <code>https</code> addresses, checked
            again at connection time and on every redirect, so a listing cannot point it inside anyone&rsquo;s network.
          </li>
        </ul>

        <h2 id="which-servers">Which servers</h2>
        <p>
          On a schedule, only remote endpoints published in the{" "}
          <a href="https://registry.modelcontextprotocol.io">official MCP Registry</a>. An endpoint stops being probed
          once no registry entry lists it.
        </p>
        <p>
          A developer can also paste a URL into lurq&rsquo;s <code>connect_check</code>. That URL is probed once, on
          their request, and the result is <strong>not stored</strong>.
        </p>

        <h2 id="how-often">How often</h2>
        <ul>
          <li>About once a day while your server answers, and every six hours for a few days after it changes.</li>
          <li>Less often when it does not answer: the gap doubles from six hours up to a week.</li>
          <li>
            A response that is not an MCP answer, including a rate-limit response, pushes the next visit out by days.
          </li>
          <li>At most two requests in flight to any one hostname at a time.</li>
        </ul>

        <h2 id="what-is-published">What lurq does with it</h2>
        <p>
          The result answers one question for developers: will this server work in the client they use, and what
          does connecting take? It records whether the endpoint answers, how clients sign in to it, deviations from
          the specification that strict clients refuse, and the tool names and schemas when they are readable
          without credentials. Accounts that run or approved a server are told when those change.
        </p>

        <h2 id="opt-out">Stop the probe</h2>
        <p>
          Email <a href="mailto:contact@lurq.run">contact@lurq.run</a> with the hostname. Every endpoint on that
          host is taken off the schedule and not probed again. Removing the server from the registry has the same
          effect for that endpoint.
        </p>
        <p>
          Something here does not match what you see in your logs? That is a bug on our side; the same address
          reaches us. For vulnerability reports, see <Link href="/security">Security</Link>.
        </p>
      </Prose>
    </PageShell>
  );
}
