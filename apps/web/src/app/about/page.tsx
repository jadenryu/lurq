import type { Metadata } from "next";
import Link from "next/link";
import { ScanSearch, RefreshCw, Eye } from "lucide-react";
import { PageShell } from "@/components/common/page-shell";
import { Prose } from "@/components/common/prose";
import { FlowDiagram } from "@/components/visuals/flow-diagram";

export const metadata: Metadata = {
  title: "About | lurq",
  description:
    "Why lurq exists: objective, evidence-scored package recommendations for AI coding agents.",
};

const principles = [
  {
    icon: ScanSearch,
    title: "Evidence over popularity",
    body: "Stars and download counts measure attention, not health. lurq scores real signals: maintenance cadence, advisories, deprecations, bundle cost.",
  },
  {
    icon: RefreshCw,
    title: "Fresh, not frozen",
    body: "Models recommend from training data that ages out. lurq re-syncs from public sources so your agent sees what's true today.",
  },
  {
    icon: Eye,
    title: "Transparent by default",
    body: "Every recommendation carries a confidence and a dataAsOf timestamp. No black-box rankings.",
  },
];

const pipeline = [
  { title: "Public APIs", sub: "npm · GitHub · deps.dev" },
  { title: "Scoring engine", sub: "health, risk, efficiency" },
  { title: "Evidence index", sub: "pgvector search" },
  { title: "Your agent", sub: "over MCP" },
];

export default function AboutPage() {
  return (
    <PageShell
      eyebrow="Company"
      title="About lurq"
      lead="lurq is a continuously-updated, evidence-scored index of JS/TS frameworks and libraries: a companion to your coding agent that recommends dependencies that are real, healthy, and current."
    >
      <Prose>
        <h2>The problem</h2>
        <p>
          AI coding agents are excellent at writing code and surprisingly poor at
          choosing what to build on. They suggest libraries that are abandoned,
          deprecated, or simply hallucinated, because their knowledge is a
          snapshot frozen at training time, ranked by how often a name appeared,
          not by whether the package is healthy now.
        </p>
        <p>
          The cost lands on you: a dependency that looked fine in the diff but
          hasn&apos;t shipped a release in three years, carries an open advisory,
          or never existed at all.
        </p>

        <h2>What lurq does</h2>
        <p>
          lurq ingests public signals from npm, GitHub, and{" "}
          <a href="https://deps.dev" target="_blank" rel="noopener noreferrer">
            deps.dev
          </a>
          , scores each package on objective health metrics, and exposes the
          result as an <strong>MCP server</strong>, a <strong>CLI</strong>, and
          an installable <strong>agent skill</strong>. Your agent asks lurq
          before it picks a dependency; lurq answers with a short, scored,
          verifiable recommendation.
        </p>

        <h2>How it works</h2>
        <p>
          Public APIs feed a scoring engine; the engine writes to an index your
          agent queries over MCP. Sync runs on a schedule, so the index stays
          current without you doing anything.
        </p>
      </Prose>

      <div className="mt-8">
        <FlowDiagram steps={pipeline} />
      </div>

      <Prose className="mt-12">
        <h2>Principles</h2>
      </Prose>
      <div className="mt-6 grid gap-4 sm:grid-cols-3">
        {principles.map((p) => {
          const Icon = p.icon;
          return (
            <div
              key={p.title}
              className="surface-glow group rounded-[var(--radius-lg)] border border-border bg-card p-5 transition-colors hover:border-foreground/20"
            >
              <div className="flex size-10 items-center justify-center rounded-lg border border-border bg-secondary text-foreground transition-transform group-hover:-translate-y-0.5">
                <Icon className="size-5" />
              </div>
              <h3 className="mt-4 text-sm font-medium text-foreground">
                {p.title}
              </h3>
              <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                {p.body}
              </p>
            </div>
          );
        })}
      </div>

      <div className="mt-12 flex flex-wrap items-center gap-4">
        <Link
          href="/book-demo"
          className="inline-flex items-center justify-center rounded-lg bg-primary px-5 py-2.5 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90"
        >
          Book a demo
        </Link>
        <Link
          href="/#contact"
          className="text-sm text-muted-foreground underline underline-offset-2 transition-colors hover:text-foreground"
        >
          Get in touch
        </Link>
      </div>
    </PageShell>
  );
}
