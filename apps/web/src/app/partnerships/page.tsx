import type { Metadata } from "next";
import { Bot, Database, Wrench } from "lucide-react";
import { PageShell } from "@/components/common/page-shell";
import { GradientBorder } from "@/components/common/gradient-border";

export const metadata: Metadata = {
  title: "Partnerships | lurq",
  description:
    "Partner with lurq: join the demand side, the supply side, or the signal layer of the marketplace agents buy dependencies through.",
};

const PARTNER_EMAIL = "contact@lurq.run";

const tracks = [
  {
    icon: Bot,
    title: "Demand side — agents & IDEs",
    body: "Serve lurq's rankings natively inside your assistant. One MCP entry, and every dependency your users' agents pick is backed by live evidence instead of training data.",
  },
  {
    icon: Database,
    title: "Supply side — registries & maintainers",
    body: "Every published package is already listed, ranked on public evidence, and never pay-to-rank. Contribute a signal source, or tell us where our evidence on your package is wrong.",
  },
  {
    icon: Wrench,
    title: "Tooling & platforms",
    body: "Embed verify/evaluate/compare into CI, code review, or dependency dashboards via the CLI and API, and resell the decision to your own users.",
  },
];

export default function PartnershipsPage() {
  return (
    <PageShell
      eyebrow="Company"
      title="Partnerships"
      lead="lurq is the market that sits between coding agents and the open-source ecosystem. If you build agents, run a registry, maintain packages, or ship developer tooling, there's a side of it to plug into."
    >
      <div className="grid gap-4 sm:grid-cols-3">
        {tracks.map((t) => {
          const Icon = t.icon;
          return (
            <div
              key={t.title}
              className="surface-glow group rounded-[var(--radius-lg)] border border-border bg-card p-5 transition-colors hover:border-foreground/20"
            >
              <div className="flex size-10 items-center justify-center rounded-lg border border-border bg-secondary text-foreground transition-transform group-hover:-translate-y-0.5">
                <Icon className="size-5" />
              </div>
              <h3 className="mt-4 text-sm font-medium text-foreground">
                {t.title}
              </h3>
              <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                {t.body}
              </p>
            </div>
          );
        })}
      </div>

      <GradientBorder className="mt-12" innerClassName="p-8 md:p-10">
        <h2 className="font-heading text-2xl font-semibold tracking-tight text-foreground">
          Let&apos;s talk
        </h2>
        <p className="mt-3 max-w-xl text-muted-foreground">
          Tell us what you&apos;re building and how lurq could fit. We read every
          message and reply personally.
        </p>
        <a
          href={`mailto:${PARTNER_EMAIL}?subject=lurq%20partnership`}
          className="mt-6 inline-flex items-center justify-center rounded-lg bg-primary px-5 py-2.5 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90"
        >
          Email the team
        </a>
      </GradientBorder>
    </PageShell>
  );
}
