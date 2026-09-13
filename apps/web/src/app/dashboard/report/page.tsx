import type { Metadata } from "next";
import { currentUser } from "@clerk/nextjs/server";
import { BuilderReportView } from "@/components/dashboard/builder-report";
import { PageBody, PageHeader } from "@/components/dashboard/page-header";

export const metadata: Metadata = {
  title: "builder report",
  description:
    "What kind of builder are you? Read from your public GitHub repos and the stacks inside them.",
};

/**
 * The builder report: the landing page's scan box lands here.
 *
 * THE ONE DASHBOARD PAGE OPEN WITHOUT AN ACCOUNT (see proxy.ts). A signed-out
 * visitor gets their archetype and the head of one repo, inside the real
 * console with every other tab visible and locked. That is the incentive the
 * old in-place card never had: the answer is theirs, the evidence and the rest
 * of the product are right there, and both are one modal sign-up away.
 *
 * Shared /scan/[owner]/[repo] links redirect here (next.config.ts).
 */
export default async function BuilderReportPage({
  searchParams,
}: {
  searchParams: Promise<{ target?: string | string[] }>;
}) {
  const [{ target }, user] = await Promise.all([searchParams, currentUser()]);

  // Someone who opened this from the nav rather than the scan box gets their
  // own profile, when they signed in with GitHub.
  const github = user?.externalAccounts.find((a) => a.provider.includes("github"))?.username;
  const initial = (typeof target === "string" ? target.trim() : "") || github || "";

  return (
    <div>
      <PageHeader
        title="builder report"
        subtitle="What kind of builder are you? Read from public repos and the stacks inside them."
      />
      <PageBody>
        <BuilderReportView initialTarget={initial} />
      </PageBody>
    </div>
  );
}
