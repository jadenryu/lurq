import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { PageShell } from "@/components/common/page-shell";
import { DOCS_URL } from "@/lib/site-links";
import { siteUrl } from "@/lib/site";
import {
  MCP_SERVER_REVALIDATE,
  fetchPublicMcpServer,
  mcpNameFromSegments,
  mcpServerPath,
  type PublicMcpServerSummary,
} from "@/lib/public-mcp";

/**
 * One public page per registry MCP server lurq has probed.
 *
 * For the developer whose server will not connect, and the agent that searched
 * on their behalf: which clients it works in, why the others fail, and how it
 * signs clients in — then the one line that lets their agent ask lurq live with
 * `connect_check`, which also hands back the config to paste. Rendered on first
 * request and revalidated daily; nothing is prebuilt.
 */

export const revalidate = 86400;

export async function generateStaticParams() {
  return [];
}

type Props = { params: Promise<{ server: string[] }> };

async function load(segments: string[]): Promise<PublicMcpServerSummary | null> {
  const name = mcpNameFromSegments(segments);
  return name.includes("/") ? fetchPublicMcpServer(name) : null;
}

const day = (iso: string | null) =>
  iso ? new Date(iso).toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" }) : "unknown";

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const s = await load((await params).server);
  if (!s) return { title: "MCP server not found | lurq", robots: { index: false } };
  const works = s.clients.filter((c) => c.verdict === "works").map((c) => c.clientName);
  const blocked = s.clients.filter((c) => c.verdict === "blocked").map((c) => c.clientName);
  const title = `${s.title ?? s.name} MCP server: which clients it works in and how to connect | lurq`;
  const description = [
    `${s.name} works in ${works.length} MCP client${works.length === 1 ? "" : "s"}`,
    works.length ? ` including ${works.slice(0, 3).join(", ")}` : "",
    blocked.length ? `, and is blocked in ${blocked.slice(0, 3).join(", ")}` : "",
    ". From a credential-free probe of its endpoint, with how clients sign in to it.",
  ].join("");
  return {
    title,
    description,
    alternates: { canonical: mcpServerPath(s.name) },
    openGraph: { type: "article", title, description, url: mcpServerPath(s.name) },
  };
}

const VERDICT_WORD = { works: "works", needs_setup: "needs setup", blocked: "blocked", unknown: "unknown" } as const;
const VERDICT_CLASS = {
  works: "text-good",
  needs_setup: "text-warn",
  blocked: "text-bad",
  unknown: "text-ink-3",
} as const;

const STATUS_WORD: Record<string, string> = {
  open: "Answering",
  auth_required: "Answering, needs sign-in",
  not_found: "Not found",
  server_error: "Server error",
  unreachable: "Unreachable",
  dns_failed: "Does not resolve",
  timeout: "Timed out",
  protocol_error: "Not answering as MCP",
  blocked: "Not checkable",
  templated: "Needs URL values",
};

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="border-t border-edge pt-3">
      <dt className="text-[11px] uppercase tracking-[0.06em] text-ink-3">{label}</dt>
      <dd className="mt-1 font-mono text-[15px] tabular-nums text-ink">{value}</dd>
    </div>
  );
}

export default async function McpServerPublicPage({ params }: Props) {
  const s = await load((await params).server);
  if (!s || !s.endpoint) notFound();
  const e = s.endpoint;

  const signIn =
    e.authMode === "none"
      ? "No credentials: it answered lurq's probe without any."
      : e.authMode === "static"
        ? "A key or token configured by hand. Clients that cannot send custom headers cannot connect."
        : e.authMode === "oauth"
          ? `OAuth sign-in. Client ID Metadata Documents: ${e.oauth?.cimd ? "yes" : "no"}. Dynamic Client Registration: ${e.oauth?.dcr ? "yes" : "no"}. PKCE S256: ${e.oauth?.pkceS256 ? "yes" : "no"}.`
          : "Not established.";

  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "SoftwareApplication",
    name: s.title ?? s.name,
    alternateName: s.name,
    description: s.description ?? undefined,
    softwareVersion: s.version,
    applicationCategory: "DeveloperApplication",
    url: siteUrl(mcpServerPath(s.name)),
    sameAs: [s.websiteUrl, s.repositoryUrl].filter(Boolean),
  };

  return (
    <PageShell eyebrow="MCP server" title={s.title ?? s.name} lead={s.description ?? undefined} width="wide">
      <script
        type="application/ld+json"
        // Escape "<" so a server description can never close the script tag.
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd).replace(/</g, "\\u003c") }}
      />

      <dl className="grid grid-cols-2 gap-x-6 gap-y-4 min-[720px]:grid-cols-4">
        <Stat label="Endpoint" value={e.status ? (STATUS_WORD[e.status] ?? e.status) : "not probed"} />
        <Stat label="Works in" value={`${s.summary.works} of ${s.clients.length} clients`} />
        <Stat label="Tools" value={e.toolNames ? String(e.toolNames.length) : "behind sign-in"} />
        <Stat label="Last checked" value={day(e.lastProbedAt)} />
      </dl>

      <section className="mt-12">
        <h2 className="text-[18px] font-medium text-ink">Does {s.title ?? s.name} work in your MCP client?</h2>
        <p className="mt-2 max-w-[62ch] text-[14px] leading-[1.6] text-ink-2">
          Registry name <code className="font-mono text-ink">{s.name}</code>, endpoint{" "}
          <code className="break-all font-mono text-ink">{e.url}</code>.
        </p>
        <ul className="mt-4 divide-y divide-edge border-y border-edge">
          {s.clients.map((c) => (
            <li key={c.client} className="flex flex-wrap items-baseline gap-x-4 gap-y-1 py-3">
              <span className="w-48 shrink-0 text-[14px] text-ink">{c.clientName}</span>
              <span className={`w-24 shrink-0 font-mono text-[13px] ${VERDICT_CLASS[c.verdict]}`}>{VERDICT_WORD[c.verdict]}</span>
              <span className="min-w-0 flex-1 text-[13px] leading-[1.5] text-ink-2">{c.reason ?? ""}</span>
            </li>
          ))}
        </ul>
      </section>

      <section className="mt-12">
        <h2 className="text-[18px] font-medium text-ink">How clients sign in</h2>
        <p className="mt-2 max-w-[62ch] text-[14px] leading-[1.6] text-ink-2">{signIn}</p>
        {e.violations.length > 0 && (
          <ul className="mt-4 space-y-2 text-[14px] leading-[1.6] text-ink-2">
            {e.violations.map((v) => (
              <li key={v.code} className="flex gap-2.5">
                <span aria-hidden className="text-ink-3">
                  ·
                </span>
                <span>{v.detail}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {e.toolNames && e.toolNames.length > 0 && (
        <section className="mt-12">
          <h2 className="text-[18px] font-medium text-ink">Tools</h2>
          <p className="mt-3 flex flex-wrap gap-2">
            {e.toolNames.map((t) => (
              <code key={t} className="rounded bg-surface-2 px-2 py-0.5 font-mono text-[12.5px] text-ink">
                {t}
              </code>
            ))}
          </p>
        </section>
      )}

      <section className="mt-12 rounded-[10px] border border-edge p-6">
        <h2 className="text-[16px] font-medium text-ink">Get the setup for your client from your agent</h2>
        <p className="mt-2 max-w-[62ch] text-[14px] leading-[1.6] text-ink-2">
          This page is a daily snapshot. lurq&apos;s <code className="font-mono">connect_check</code> answers for the client
          you are wiring this server into, with the exact steps and the config to paste in that client&apos;s own format, and{" "}
          <code className="font-mono">lurq mcp-pin</code> tells you when the server changes. One command connects Claude
          Code, Cursor, VS Code and other agents:
        </p>
        <pre className="mt-4 overflow-x-auto rounded-md bg-surface-2 px-4 py-3 font-mono text-[13px] text-ink">npx lurqrun</pre>
        <p className="mt-3 text-[13px] text-ink-3">
          Free to start.{" "}
          <Link href={`${DOCS_URL}/mcp-tools#connect_check`} className="underline underline-offset-2">
            How connect_check works
          </Link>
        </p>
      </section>

      <p className="mt-12 text-[12px] leading-[1.6] text-ink-3">
        From lurq&apos;s credential-free probe of this server&apos;s endpoint on {day(s.dataAsOf)}, and each client&apos;s own
        documentation. This page refreshes every {MCP_SERVER_REVALIDATE / 3600} hours.{" "}
        <Link href="/probe" className="underline underline-offset-2">
          How the probe works, and how maintainers opt out
        </Link>
        .
        {s.repositoryUrl ? (
          <>
            {" "}
            <a href={s.repositoryUrl} rel="nofollow noopener" className="underline underline-offset-2">
              Source repository
            </a>
            .
          </>
        ) : null}
      </p>
    </PageShell>
  );
}
