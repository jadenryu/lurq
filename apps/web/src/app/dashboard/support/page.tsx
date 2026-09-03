import type { Metadata } from "next";
import Link from "next/link";
import { PageBody, PageHeader } from "@/components/dashboard/page-header";
import { Panel, PanelHeader } from "@/components/dashboard/panel";
import { DOCS_URL } from "@/lib/site-links";

export const metadata: Metadata = {
  title: "support",
  description: "Documentation, the in-dashboard guide, and how to reach a person.",
};

/**
 * Where the old "support" nav group went.
 *
 * The rail used to carry three rows for this — "how to use", "docs" and
 * "support" — which is three rows spent on the same job: you are stuck and want
 * somewhere to go. They are one row now, and this page is what it opens. Nothing
 * was retired to do it: the guide is still a full page at /dashboard/guide and
 * still linked from getting-started, the docs zone is untouched, and the contact
 * form is the same one the marketing page anchors.
 *
 * Ordered by how much of the user's time each costs, cheapest first. Reading a
 * page beats waiting on a reply, so the reply is last.
 */
const ROUTES = [
  {
    href: "/dashboard/guide",
    title: "how to use lurq",
    body: "The in-dashboard guide: connecting an agent, what each tool answers, how the scores are built. Transcribed from the live backend, so it cannot describe a capability the server does not expose.",
    cta: "open the guide",
    external: false,
  },
  {
    href: DOCS_URL,
    title: "documentation",
    body: "Quick start, the full CLI reference, the MCP tool catalog, how the index is built, and self-hosting.",
    cta: "read the docs",
    external: true,
  },
  {
    href: "/#contact",
    title: "talk to a person",
    body: "Something is wrong, something is missing, or you want to tell us the index got a package wrong. The last one is the most useful message we get.",
    cta: "get in touch",
    external: true,
  },
] as const;

export default function DashboardSupportPage() {
  return (
    <div>
      <PageHeader
        title="support"
        subtitle="Documentation, the in-dashboard guide, and how to reach a person."
      />

      <PageBody>
        <div className="grid gap-3 md:grid-cols-3">
        {ROUTES.map((route) => (
          <Panel key={route.href}>
            <PanelHeader title={route.title} />
            <p className="mt-3 text-sm leading-relaxed text-muted-foreground">{route.body}</p>
            {/* A cross-zone or on-page-anchor target is a real navigation, not a
                client transition: /docs is a different Next app behind a rewrite
                and /#contact is a hash on another route. <Link> would try to
                soft-navigate both. */}
            {route.external ? (
              <a
                href={route.href}
                className="mt-4 inline-block text-sm underline underline-offset-4 hover:text-foreground"
              >
                {route.cta}
              </a>
            ) : (
              <Link
                href={route.href}
                className="mt-4 inline-block text-sm underline underline-offset-4 hover:text-foreground"
              >
                {route.cta}
              </Link>
            )}
          </Panel>
        ))}
      </div>
      </PageBody>
    </div>
  );
}
