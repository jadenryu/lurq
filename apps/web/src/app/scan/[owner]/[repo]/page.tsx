import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { auth } from "@clerk/nextjs/server";
import { ScanReport } from "@/components/site/scan-report";
import { ScanSeen } from "@/components/site/scan-seen";
import { scanHeadline, scanRepo, FREE_DEPS } from "@/lib/public-scan";
import { siteUrl } from "@/lib/site";

/**
 * One repo's public drift report, at a URL.
 *
 * THIS PAGE EXISTS TO BE PASTED. The hero box answers a visitor who is already
 * here; it leaves no address behind, so the answer dies in the tab that asked
 * for it. A scan result is the one thing on this site somebody wants to send to
 * a colleague — "look what our stack looks like" — and a shareable URL turns
 * every scan into a possible visitor instead of a terminal one. The social card
 * next door carries the numbers, so the link argues before anyone clicks it.
 *
 * It is also the only indexable proof surface lurq has: one page per repo,
 * server-rendered with real numbers, for queries nobody is writing landing-page
 * copy for.
 *
 * PUBLIC ON PURPOSE. proxy.ts protects `/dashboard(.*)` and nothing else, so
 * this route is reachable signed-out by default — which is the requirement, not
 * an oversight. Everything it renders is derived from a public package.json and
 * the public npm index.
 */

/**
 * Not prerendered: the set of repos is every repo on GitHub, and the numbers
 * change when the index does. The backend caches by target, so the marginal
 * cost of a shared link is a JSON fetch, not a scan.
 */
export const dynamic = "force-dynamic";

interface Params {
  params: Promise<{ owner: string; repo: string }>;
}

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { owner, repo } = await params;
  const full = `${owner}/${repo}`;
  const scan = await scanRepo(owner, repo);
  const path = `/scan/${full}`;

  const title = `${full} — dependency drift | lurq`;
  const description = scan
    ? `${full}: ${scanHeadline(scan)} Read from the root package.json against the lurq index.`
    : `Scan ${full} for dependency drift, advisories and upgrade conflicts.`;

  return {
    title,
    description,
    alternates: { canonical: path },
    openGraph: {
      type: "website",
      siteName: "lurq",
      url: siteUrl(path),
      title,
      description,
    },
    twitter: { card: "summary_large_image", title, description },
  };
}

export default async function ScanPage({ params }: Params) {
  const { owner, repo } = await params;
  const [scan, { userId }] = await Promise.all([scanRepo(owner, repo), auth()]);
  if (!scan) notFound();

  const signedIn = userId !== null;
  const gated = signedIn ? 0 : Math.max(0, scan.deps.length - FREE_DEPS);

  return (
    <div
      data-surface="room"
      className="relative isolate min-h-svh bg-ground px-5 py-16 text-ink sm:py-24"
    >
      <div className="mx-auto w-full max-w-[720px]">
        <Link
          href="/"
          className="font-mono text-[12.5px] text-ink-3 underline-offset-4 transition-colors hover:text-ink hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-mark"
        >
          lurq
        </Link>

        <h1 className="mt-7 font-sans text-[clamp(26px,4vw,36px)] font-medium leading-[1.15] tracking-[-0.02em]">
          {scan.repo}
        </h1>
        <p className="mt-2.5 max-w-[52ch] text-[14.5px] leading-[1.6] text-ink-2">
          {scanHeadline(scan)} Read from the repository&rsquo;s root{" "}
          <span className="font-mono text-[13px]">package.json</span>, checked against the lurq
          index.
        </p>

        <div className="mt-8">
          <ScanReport scan={scan} signedIn={signedIn} />
        </div>

        {/* The other door out, for somebody who came in on a shared link and
            wants their own answer rather than this one. */}
        <p className="mt-7 text-[13px] leading-[1.6] text-ink-3">
          <Link
            href="/"
            className="text-mark underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-mark"
          >
            Scan your own repo
          </Link>{" "}
          — public repos, no sign-in, nothing installed.
        </p>
      </div>

      <ScanSeen repo={scan.repo} signedIn={signedIn} gated={gated} />
    </div>
  );
}
