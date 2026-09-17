import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { PageShell } from "@/components/common/page-shell";
import { DOCS_URL } from "@/lib/site-links";
import { siteUrl } from "@/lib/site";
import {
  fetchPublicUpgrade,
  packagePath,
  upgradePath,
  type PublicUpgrade,
  type UpgradeVerdict,
} from "@/lib/public-packages";

/**
 * /npm/<name>/<from>-to-<to>: what one major version removed, renamed or changed.
 *
 * Written for the reader who arrives mid-breakage: a developer, or an agent that
 * searched an error like "X is not exported from Y" during an upgrade. The page
 * answers with the complete list, then hands them the one command that checks
 * the same jump against their own code, which needs no account.
 *
 * Only jumps the API serves exist (src/mcp/publicUpgrades.ts: public set, latest
 * of consecutive majors). A pending page is noindex until its diff is ready.
 */

type Jump = { name: string; from: number; to: number };

const HEADLINE: Record<UpgradeVerdict, string> = {
  "removes-exports": "removes or renames exports your code may import",
  "arity-changed": "changes how many arguments some functions take",
  "types-only": "removes type exports: breaks tsc, not the runtime",
  clean: "keeps every export lurq extracted, with the same argument counts",
  unknown: "could not be compared yet",
};

const day = (iso: string | null) =>
  iso ? new Date(iso).toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" }) : "unknown";

function counts(u: PublicUpgrade): string {
  return [
    `${u.removed.length} removed`,
    `${u.renamed.length} renamed`,
    `${u.arityChanged.length} signature changes`,
    `${u.typeOnlyRemoved.length} types removed`,
  ].join(", ");
}

export async function upgradeMetadata({ name, from, to }: Jump): Promise<Metadata> {
  const u = await fetchPublicUpgrade(name, from, to);
  if (!u) return { title: "Upgrade page not found | lurq", robots: { index: false } };
  const title = `Upgrading ${name} from ${from} to ${to}: removed and renamed exports | lurq`;
  const description =
    u.status === "ready"
      ? `${name} ${u.pair.fromVersion} → ${u.pair.toVersion}: ${counts(u)}. Check your own code against it with one command.`
      : `What ${name} ${u.pair.toVersion} removed, renamed or changed since ${u.pair.fromVersion}.`;
  const path = upgradePath(name, from, to);
  return {
    title,
    description,
    alternates: { canonical: path },
    openGraph: { type: "article", title, description, url: path },
    // Pending pages have nothing to rank yet; they are indexed once the diff is in.
    robots: u.status === "ready" ? undefined : { index: false, follow: true },
  };
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="border-t border-edge pt-3">
      <dt className="text-[11px] uppercase tracking-[0.06em] text-ink-3">{label}</dt>
      <dd className="mt-1 font-mono text-[15px] tabular-nums text-ink">{value.toLocaleString("en-US")}</dd>
    </div>
  );
}

function Section({ title, note, children }: { title: string; note: string; children: React.ReactNode }) {
  return (
    <section className="mt-10">
      <h2 className="text-[16px] font-medium text-ink">{title}</h2>
      <p className="mt-1 text-[13px] text-ink-3">{note}</p>
      <ul className="mt-3 divide-y divide-edge border-y border-edge font-mono text-[13px]">{children}</ul>
    </section>
  );
}

function Row({ children }: { children: React.ReactNode }) {
  return <li className="flex flex-wrap items-baseline gap-x-3 gap-y-1 break-all py-2 text-ink">{children}</li>;
}

export async function UpgradePage({ name, from, to }: Jump) {
  const u = await fetchPublicUpgrade(name, from, to);
  if (!u) notFound();

  const { fromVersion, toVersion } = u.pair;
  const check = `npx lurqrun check-upgrade --upgrade ${name}@${fromVersion}..${toVersion}`;
  const ready = u.status === "ready";

  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "TechArticle",
    headline: `Upgrading ${name} from ${fromVersion} to ${toVersion}`,
    description: ready ? `${counts(u)}.` : undefined,
    dateModified: u.observedAt ?? undefined,
    url: siteUrl(upgradePath(name, from, to)),
    about: { "@type": "SoftwareSourceCode", name, version: toVersion, programmingLanguage: "JavaScript" },
  };

  return (
    <PageShell
      eyebrow="npm upgrade"
      title={`${name} ${from} → ${to}`}
      lead={`${fromVersion} → ${toVersion}. What the package's exports lost, renamed or changed between the two releases, from lurq's extraction of both published tarballs.`}
      width="wide"
    >
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd).replace(/</g, "\\u003c") }}
      />

      <p className="text-[15px] leading-[1.6] text-ink">
        {ready ? (
          <>
            {name} {toVersion} {HEADLINE[u.verdict]}.
          </>
        ) : (
          <>lurq is extracting both releases. This page fills in within the hour.</>
        )}
      </p>
      {u.inconclusive && ready ? <p className="mt-2 text-[13px] text-ink-3">{u.inconclusive}</p> : null}

      {ready ? (
        <dl className="mt-8 grid grid-cols-2 gap-x-6 gap-y-4 min-[720px]:grid-cols-3">
          <Stat label="Removed" value={u.removed.length} />
          <Stat label="Renamed" value={u.renamed.length} />
          <Stat label="Signature changes" value={u.arityChanged.length} />
          <Stat label="Types removed" value={u.typeOnlyRemoved.length} />
          <Stat label="Newly deprecated" value={u.deprecated.length} />
          <Stat label="Added" value={u.added} />
        </dl>
      ) : null}

      <section className="mt-10 rounded-[10px] border border-edge p-6">
        <h2 className="text-[16px] font-medium text-ink">Does this break your code?</h2>
        <p className="mt-2 max-w-[64ch] text-[14px] leading-[1.6] text-ink-2">
          Run this in your project. It compares both releases against the names your code actually imports, locally,
          with no account and nothing sent to lurq:
        </p>
        <pre className="mt-4 overflow-x-auto rounded-md bg-surface-2 px-4 py-3 font-mono text-[13px] text-ink">{check}</pre>
        <p className="mt-4 max-w-[64ch] text-[14px] leading-[1.6] text-ink-2">
          To have your coding agent check upgrades like this before it writes them, connect lurq to Claude Code, Cursor,
          VS Code or Codex:
        </p>
        <pre className="mt-3 overflow-x-auto rounded-md bg-surface-2 px-4 py-3 font-mono text-[13px] text-ink">npx lurqrun</pre>
        <p className="mt-3 text-[13px] text-ink-3">
          <Link href={`${DOCS_URL}/quickstart`} className="underline underline-offset-2">
            Quickstart
          </Link>
        </p>
      </section>

      {u.removed.length > 0 ? (
        <Section title="Removed" note="Gone at runtime, with no replacement found under another name. Imports of these fail.">
          {u.removed.map((r) => (
            <Row key={r.path}>
              <span>{r.path}</span>
              <span className="font-sans text-[12px] text-ink-3">{r.kind}</span>
            </Row>
          ))}
        </Section>
      ) : null}

      {u.renamed.length > 0 ? (
        <Section title="Renamed" note="The old name is gone; the same implementation is exported under the new one.">
          {u.renamed.map((r) => (
            <Row key={r.path}>
              <span>{r.path}</span>
              <span aria-hidden className="text-ink-3">
                →
              </span>
              <span>{r.to.join(", ")}</span>
            </Row>
          ))}
        </Section>
      ) : null}

      {u.arityChanged.length > 0 ? (
        <Section title="Signature changes" note="Still exported, but the number of arguments it reads changed.">
          {u.arityChanged.map((a) => (
            <Row key={a.path}>
              <span>{a.path}</span>
              <span className="font-sans text-[12px] text-ink-3">
                {a.from ?? "?"} → {a.to ?? "?"} arguments
              </span>
            </Row>
          ))}
        </Section>
      ) : null}

      {u.typeOnlyRemoved.length > 0 ? (
        <Section title="Types removed" note="Type-only exports: tsc fails, the runtime does not.">
          {u.typeOnlyRemoved.map((t) => (
            <Row key={t}>{t}</Row>
          ))}
        </Section>
      ) : null}

      {u.deprecated.length > 0 ? (
        <Section title="Newly deprecated" note={`Still exported in ${toVersion}, marked deprecated.`}>
          {u.deprecated.map((d) => (
            <Row key={d}>{d}</Row>
          ))}
        </Section>
      ) : null}

      {u.truncated ? (
        <p className="mt-4 text-[13px] text-ink-3">
          Some lists stop at 500 entries. The command above checks the full set against your code.
        </p>
      ) : null}

      <p className="mt-12 text-[12px] leading-[1.6] text-ink-3">
        An export diff shows what a release removed or re-signatured, not behaviour changes: read the changelog for
        those.{" "}
        {ready ? `Extracted ${day(u.observedAt)}. ` : null}
        <Link href={packagePath(name)} className="underline underline-offset-2">
          {name} on lurq
        </Link>
        .
      </p>
    </PageShell>
  );
}
