import type { Metadata } from "next";
import Link from "next/link";
import { ScanSearch, RefreshCw, Eye } from "lucide-react";
import { PageShell } from "@/components/common/page-shell";
import { Prose } from "@/components/common/prose";
import { FlowDiagram } from "@/components/visuals/flow-diagram";

export const metadata: Metadata = {
  title: "About | lurq",
  description:
    "Why lurq exists: execution-verified answers about the packages AI coding agents choose.",
};

const principles = [
  {
    icon: ScanSearch,
    title: "Evidence over popularity",
    body: "Stars and download counts measure attention, not health. lurq ranks real signals: maintenance cadence, advisories, deprecations, bundle cost.",
  },
  {
    icon: Eye,
    title: "Proof over opinion",
    body: "Where a claim can be settled by running something, we run it. Install it in a sandbox, import it, co-install the set, and keep the evidence.",
  },
  {
    icon: RefreshCw,
    title: "Fresh, not frozen",
    body: "Models recommend from training data that ages out. lurq re-syncs daily, so your agent sees the ecosystem as it is today.",
  },
];

const pipeline = [
  { title: "Public signals", sub: "npm · GitHub · deps.dev" },
  { title: "Scoring engine", sub: "health, risk, efficiency" },
  { title: "Sandbox", sub: "install · import · co-install" },
  { title: "Your agent", sub: "over MCP" },
];

export default function AboutPage() {
  return (
    <PageShell
      eyebrow="Company"
      title="About lurq"
      lead="Coding agents choose most of the dependencies now, from a snapshot of the ecosystem frozen at training time. lurq is the layer they check first: live signals where metadata is enough, and a real sandbox where it isn't."
    >
      <Prose>
        <h2>The problem</h2>
        <p>
          For twenty years a developer chose the dependency. Now an agent does,
          in seconds, from a snapshot frozen at training time and ranked by how
          often a name appeared in text rather than by whether the package is
          healthy today.
        </p>
        <p>
          The cost lands on you: a dependency that looked fine in the diff but
          hasn&apos;t shipped a release in three years, carries an open advisory,
          or never existed at all. That last one is measurable, published
          research puts hallucinated package names at over 5% of commercial-model
          recommendations, and the same fake names recur across runs, which is
          what makes them registrable by an attacker.
        </p>

        <h2>What lurq does</h2>
        <p>
          lurq ingests public signals from npm, GitHub, and{" "}
          <a href="https://deps.dev" target="_blank" rel="noopener noreferrer">
            deps.dev
          </a>{" "}
          and scores each package on health and quality, then exposes the result
          as an <strong>MCP server</strong>, a <strong>CLI</strong>, an{" "}
          <strong>HTTP API</strong>, and an installable <strong>skill</strong>.
          Your agent asks before it picks; lurq answers with something short,
          scored, and checkable.
        </p>

        <h2>Where the evidence comes from</h2>
        <p>
          Most of what you can know about a package is readable: downloads,
          release cadence, advisories, bundle size. Some of it is not. Whether a
          package installs cleanly, whether it imports without throwing, whether
          two versions can coexist in one tree, those are only knowable by
          running them. So lurq runs them, in an isolated sandbox, and keeps the
          result alongside the score.
        </p>
        <p>
          That is also why <strong>plan</strong> exists. Six individually healthy
          packages can still refuse to install together, and no amount of
          per-package scoring catches it. Compatibility is mined from real
          co-installs, so a stack is checked as a set rather than as a list.
        </p>

        <h2>Where this goes</h2>
        <p>
          Packages are the beachhead: the largest registry, the fastest churn,
          the most agent traffic. The same approach extends to everything else an
          agent depends on and can be wrong about, MCP servers, HTTP APIs, CLI
          tools: anywhere a claim can be settled by running something rather
          than by asking around.
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
          href="/sign-up"
          className="inline-flex items-center justify-center rounded-lg bg-primary px-5 py-2.5 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90"
        >
          Get started free
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
