import type { Metadata } from "next";
import Link from "next/link";
import { PageFrame } from "@/components/site/page-frame";

export const metadata: Metadata = {
  title: "Unsubscribe",
  robots: { index: false, follow: false },
};

const LABEL = { urgent: "urgent alerts", digest: "the weekly summary" } as const;
type Kind = keyof typeof LABEL;

const isKind = (v: unknown): v is Kind => v === "urgent" || v === "digest";

/**
 * The page an email's "turn these off" link opens.
 *
 * It asks before it acts. Mail scanners and link previewers follow every URL in
 * a message, so a link that unsubscribed on GET would switch people's alerts off
 * without them ever seeing the email. Mail clients' own one-click unsubscribe
 * POSTs straight to /api/unsubscribe and never reaches this page.
 */
export default async function UnsubscribePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const token = typeof params.token === "string" ? params.token : "";
  const kind = params.kind;
  const done = params.done === "1";
  const failed = params.error === "1";

  if (done && isKind(kind)) {
    return (
      <PageFrame eyebrow="Email" title="You're unsubscribed" lead={`lurq won't send you ${LABEL[kind]} any more.`}>
        <p className="text-ink-2">
          Everything is still in your dashboard. You can turn email back on in{" "}
          <Link href="/dashboard/preferences" className="underline underline-offset-4">
            preferences
          </Link>
          .
        </p>
      </PageFrame>
    );
  }

  if (!token || !isKind(kind)) {
    return (
      <PageFrame eyebrow="Email" title="This link is incomplete" lead="It may have been cut off by your mail client.">
        <p className="text-ink-2">
          Manage every email lurq sends you in{" "}
          <Link href="/dashboard/preferences" className="underline underline-offset-4">
            preferences
          </Link>
          .
        </p>
      </PageFrame>
    );
  }

  return (
    <PageFrame eyebrow="Email" title={`Turn off ${LABEL[kind]}?`} lead="Other email settings stay as they are.">
      {failed && <p className="mb-4 text-ink-2">That didn&rsquo;t go through. Try again in a moment.</p>}
      <form method="post" action="/api/unsubscribe">
        <input type="hidden" name="token" value={token} />
        <input type="hidden" name="kind" value={kind} />
        <button type="submit" className="h-10 rounded-[var(--radius-control)] border border-edge px-4 text-sm text-ink hover:bg-surface-2">
          Turn off {LABEL[kind]}
        </button>
      </form>
    </PageFrame>
  );
}
