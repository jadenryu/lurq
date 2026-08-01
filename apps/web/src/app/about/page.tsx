import type { Metadata } from "next";
import Link from "next/link";
import { ScanSearch, RefreshCw, Eye } from "lucide-react";
import { PageShell } from "@/components/common/page-shell";
import { Prose } from "@/components/common/prose";
import { FlowDiagram } from "@/components/visuals/flow-diagram";

export const metadata: Metadata = {
  title: "About | lurq",
  description:
    "Why lurq exists: the evidence-ranked marketplace layer AI coding agents buy their dependencies through.",
};

const principles = [
  {
    icon: ScanSearch,
    title: "Evidence over popularity",
    body: "Stars and download counts measure attention, not health. lurq ranks real signals: maintenance cadence, advisories, deprecations, bundle cost.",
  },
  {
    icon: Eye,
    title: "Never pay-to-rank",
    body: "Placement is not for sale, at any price. Every ranking is reproducible from public evidence and carries a confidence and a dataAsOf timestamp.",
  },
  {
    icon: RefreshCw,
    title: "Fresh, not frozen",
    body: "Models recommend from training data that ages out. lurq re-syncs daily, then learns from what agents report back after the pick ships.",
  },
];

const pipeline = [
  { title: "Public signals", sub: "npm · GitHub · deps.dev" },
  { title: "Ranking engine", sub: "health, risk, efficiency" },
  { title: "Evidence index", sub: "pgvector matching" },
  { title: "Agent buys", sub: "over MCP · reports back" },
];

export default function AboutPage() {
  return (
    <PageShell
      eyebrow="Company"
      title="About lurq"
      lead="Software procurement is quietly moving from humans to agents. lurq is the marketplace layer that decision runs through: a live, evidence-ranked market of JS/TS packages, served to coding agents at the moment they choose."
    >
      <Prose>
        <h2>The shift</h2>
        <p>
          For twenty years a developer chose the dependency. Now an agent does,
          hundreds of times a week, in seconds, from a snapshot of the ecosystem
          frozen at training time and ranked by how often a name appeared in text
          rather than by whether the package is healthy now.
        </p>
        <p>
          The cost lands on the company: a dependency that looked fine in the
          diff but hasn&apos;t shipped a release in three years, carries an open
          advisory, or never existed at all. As the share of agent-written code
          climbs, so does the value of being the layer that decision passes
          through.
        </p>

        <h2>The market</h2>
        <p>
          lurq is two-sided by construction. On the <strong>demand side</strong>,
          coding agents reach it through an <strong>MCP server</strong>, a{" "}
          <strong>CLI</strong>, an <strong>HTTP API</strong>, and an installable{" "}
          <strong>skill</strong> — free, instant, and inside tools teams already
          run. On the <strong>supply side</strong>, every published package is
          listed automatically and ranked on public signals from npm, GitHub, and{" "}
          <a href="https://deps.dev" target="_blank" rel="noopener noreferrer">
            deps.dev
          </a>
          . Maintainers never apply, and they never pay.
        </p>

        <h2>The loop</h2>
        <p>
          Public APIs feed a ranking engine; the engine writes to an index agents
          query over MCP; agents report back what actually happened after the
          pick shipped. Those outcomes re-rank the market, so every call makes
          the next answer better — and that post-decision data is something only
          the layer sitting inside the decision ever gets to see.
        </p>

        <h2>Where this goes</h2>
        <p>
          JS/TS packages are the beachhead: the largest registry, the fastest
          churn, the most agent traffic. The same market structure extends to
          every other slot an agent fills — other language ecosystems first, then
          the paid infrastructure an agent increasingly selects on a
          company&apos;s behalf: auth, payments, databases, email,
          observability. The decision is the product; packages are where it
          starts.
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
