import type { Metadata } from "next";
import { Bot, Database, Wrench } from "lucide-react";
import { PageShell } from "@/components/common/page-shell";
import { GradientBorder } from "@/components/common/gradient-border";

export const metadata: Metadata = {
  title: "Partnerships | lurq",
  description:
    "Partner with lurq: integrations, registries, and tooling for AI coding agents.",
};

const PARTNER_EMAIL = "jadenryu@gmail.com";

const tracks = [
  {
    icon: Bot,
    title: "Agents & IDEs",
    body: "Ship lurq's recommendations natively inside your assistant. One MCP entry and your users get fresh, scored dependency picks.",
  },
  {
    icon: Database,
    title: "Registries & data",
    body: "Contribute a signal source or surface lurq scores in your ecosystem. We're expanding beyond npm toward the wider package world.",
  },
  {
    icon: Wrench,
    title: "Tooling & platforms",
    body: "Embed verify/evaluate/compare into CI, code review, or dependency dashboards via the CLI and API.",
  },
];

export default function PartnershipsPage() {
  return (
    <PageShell
      eyebrow="Company"
      title="Partnerships"
      lead="lurq sits between your coding agent and the open-source ecosystem. If you build agents, registries, or developer tooling, there's a natural place to plug in."
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
