import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { PageShell } from "@/components/common/page-shell";
import { DOCS_URL } from "@/lib/site-links";
import { siteUrl } from "@/lib/site";
import {
  PACKAGE_REVALIDATE,
  fetchPublicPackage,
  packagePath,
  type PublicPackageSummary,
} from "@/lib/public-packages";

/**
 * One public page per popular npm package.
 *
 * Written for two readers who arrive from a search: a developer asking whether a
 * package is safe to depend on, and an agent that web-searched the same thing.
 * Both get lurq's headline answer, where it comes from, and the one line that
 * lets their agent ask lurq directly next time. The full breakdown stays behind
 * the API (src/mcp/publicPackages.ts says why).
 *
 * Rendered on first request and revalidated daily; nothing is prebuilt, so a
 * deploy does not fan out five thousand API calls.
 */

export const revalidate = 86400;

export async function generateStaticParams() {
  return [];
}

type Props = { params: Promise<{ name: string[] }> };

async function load(params: Props["params"]): Promise<PublicPackageSummary | null> {
  const { name } = await params;
  return fetchPublicPackage(name.map((s) => decodeURIComponent(s)).join("/"));
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const pkg = await load(params);
  if (!pkg) return { title: "Package not found | lurq", robots: { index: false } };
  const title = `${pkg.name}: health score, advisories and alternatives | lurq`;
  const description = [
    pkg.healthScore !== null ? `${pkg.name} scores ${pkg.healthScore}/100 on lurq` : pkg.name,
    pkg.deprecated ? "and is deprecated" : null,
    pkg.advisories?.severe ? `with ${pkg.advisories.severe} high or critical advisories` : null,
  ]
    .filter(Boolean)
    .join(" ")
    .concat(". Evidence from npm, GitHub and advisory data, plus better-scored alternatives.");
  return {
    title,
    description,
    alternates: { canonical: packagePath(pkg.name) },
    openGraph: { type: "article", title, description, url: packagePath(pkg.name) },
  };
}

const fmt = (n: number | null) => (n === null ? "unknown" : n.toLocaleString("en-US"));
const day = (iso: string | null) =>
  iso ? new Date(iso).toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" }) : "unknown";

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="border-t border-edge pt-3">
      <dt className="text-[11px] uppercase tracking-[0.06em] text-ink-3">{label}</dt>
      <dd className="mt-1 font-mono text-[15px] tabular-nums text-ink">{value}</dd>
    </div>
  );
}

export default async function PackagePage({ params }: Props) {
  const pkg = await load(params);
  if (!pkg) notFound();

  const flags = [
    pkg.deprecated ? "Deprecated on npm" : null,
    pkg.archived ? "Repository archived" : null,
    pkg.advisories === null
      ? "Advisories not yet checked"
      : pkg.advisories.total > 0
        ? `${pkg.advisories.total} known advisories (${pkg.advisories.severe} high or critical)`
        : "No known advisories",
  ].filter((f): f is string => f !== null);

  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "SoftwareSourceCode",
    name: pkg.name,
    description: pkg.description ?? undefined,
    version: pkg.latestVersion ?? undefined,
    license: pkg.license ?? undefined,
    codeRepository: pkg.repoUrl ?? undefined,
    programmingLanguage: "JavaScript",
    runtimePlatform: "Node.js",
    url: siteUrl(packagePath(pkg.name)),
  };

  return (
    <PageShell eyebrow="npm package" title={pkg.name} lead={pkg.description ?? undefined} width="wide">
      <script
        type="application/ld+json"
        // Escape "<" so a package description can never close the script tag.
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd).replace(/</g, "\\u003c") }}
      />

      <dl className="grid grid-cols-2 gap-x-6 gap-y-4 min-[720px]:grid-cols-3">
        <Stat label="lurq health score" value={pkg.healthScore === null ? "unscored" : `${pkg.healthScore}/100`} />
        <Stat label="Confidence" value={pkg.confidence ?? "unknown"} />
        <Stat label="Weekly downloads" value={fmt(pkg.weeklyDownloads)} />
        <Stat label="Latest version" value={pkg.latestVersion ?? "unknown"} />
        <Stat label="Last release" value={day(pkg.lastReleaseAt)} />
        <Stat label="License" value={pkg.license ?? "unknown"} />
      </dl>

      <section className="mt-12">
        <h2 className="text-[18px] font-medium text-ink">Should you depend on {pkg.name}?</h2>
        <p className="mt-2 text-[14px] text-ink-2">
          lurq&apos;s verdict: <span className="font-mono uppercase text-ink">{pkg.verdict.level}</span>
        </p>
        <ul className="mt-4 space-y-2 text-[14px] leading-[1.6] text-ink-2">
          {[...flags, ...pkg.verdict.reasons].map((line) => (
            <li key={line} className="flex gap-2.5">
              <span aria-hidden className="text-ink-3">
                ·
              </span>
              <span>{line}</span>
            </li>
          ))}
        </ul>
      </section>

      <section className="mt-12 rounded-[10px] border border-edge p-6">
        <h2 className="text-[16px] font-medium text-ink">Check this from your coding agent</h2>
        <p className="mt-2 max-w-[62ch] text-[14px] leading-[1.6] text-ink-2">
          This page is a daily snapshot. lurq&apos;s <code className="font-mono">verify</code> tool
          checks {pkg.name} at the exact version your agent is about to install, and{" "}
          <code className="font-mono">compat</code> checks it against the rest of your stack. One
          command connects Claude Code, Cursor, VS Code and other agents:
        </p>
        <pre className="mt-4 overflow-x-auto rounded-md bg-surface-2 px-4 py-3 font-mono text-[13px] text-ink">
          npx lurqrun
        </pre>
        <p className="mt-3 text-[13px] text-ink-3">
          Free to start.{" "}
          <Link href={`${DOCS_URL}/quickstart`} className="underline underline-offset-2">
            Quickstart
          </Link>
        </p>
      </section>

      {pkg.alternatives.length > 0 ? (
        <section className="mt-12">
          <h2 className="text-[18px] font-medium text-ink">
            {pkg.category ? `Other ${pkg.category} packages lurq scores` : "Alternatives"}
          </h2>
          <ul className="mt-4 divide-y divide-edge border-y border-edge">
            {pkg.alternatives.map((alt) => (
              <li key={alt.name} className="flex items-baseline justify-between gap-4 py-3">
                <Link href={packagePath(alt.name)} className="font-mono text-[14px] text-ink hover:underline">
                  {alt.name}
                </Link>
                <span className="font-mono text-[13px] tabular-nums text-ink-3">
                  {alt.healthScore === null ? "unscored" : `${alt.healthScore}/100`}
                  {alt.confidence ? ` · ${alt.confidence}` : ""}
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <p className="mt-12 text-[12px] leading-[1.6] text-ink-3">
        Scored from public signals (npm registry, GitHub, deps.dev and advisory databases). Data as of{" "}
        {day(pkg.dataAsOf)}; this page refreshes every {PACKAGE_REVALIDATE / 3600} hours.
        {pkg.repoUrl ? (
          <>
            {" "}
            <a href={pkg.repoUrl} rel="nofollow noopener" className="underline underline-offset-2">
              Source repository
            </a>
            .
          </>
        ) : null}
      </p>
    </PageShell>
  );
}
