import type { Metadata } from "next";
import { Plus, PenLine, Wrench } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { PageShell } from "@/components/common/page-shell";

export const metadata: Metadata = {
  title: "Changelog | lurq",
  description: "What's new in lurq.",
};

type Tag = "Added" | "Changed" | "Fixed";

interface Entry {
  version: string;
  date: string;
  badge?: string;
  changes: { tag: Tag; text: string }[];
}

// Newest first. Seeded with the real 0.0.1 release; extend as we ship.
const entries: Entry[] = [
  {
    version: "0.0.1",
    date: "June 23, 2026",
    badge: "First release",
    changes: [
      { tag: "Added", text: "First public release, published to npm as lurqrun (the CLI command stays lurq)." },
      { tag: "Added", text: "MCP server (serve) exposing recommend, evaluate, compare, verify, and diagram." },
      { tag: "Added", text: "CLI mirroring the MCP tools, runnable via npx with no global install." },
      { tag: "Added", text: "install-skill — registers lurq as an MCP server in Claude Code, Cursor, Windsurf, Copilot, and Codex." },
      { tag: "Added", text: "Scoring engine over npm, GitHub, and deps.dev signals with a daily sync." },
      { tag: "Fixed", text: "recommend category inference (date/time queries no longer match the linting rule first)." },
    ],
  },
  {
    version: "Pre-release",
    date: "June 2026",
    changes: [
      { tag: "Added", text: "Marketing site: hero, IDE marquee, showcase, reviews, and FAQ." },
      { tag: "Added", text: "Curated seed index and pgvector-backed semantic search with a local embedding fallback." },
    ],
  },
];

const tagMeta: Record<Tag, { icon: LucideIcon; className: string }> = {
  Added: { icon: Plus, className: "border-border bg-secondary text-foreground" },
  Changed: { icon: PenLine, className: "border-border bg-secondary text-foreground" },
  Fixed: { icon: Wrench, className: "border-border bg-card text-muted-foreground" },
};

export default function ChangelogPage() {
  return (
    <PageShell
      eyebrow="Product"
      title="Changelog"
      lead="A running log of what's new in lurq. lurq is in pre-alpha — expect frequent, fast-moving updates."
    >
      <div className="relative space-y-14">
        {/* gradient connector line running down the timeline */}
        <span
          aria-hidden
          className="absolute left-[5px] top-2 bottom-2 w-px bg-gradient-to-b from-foreground/30 via-border to-transparent"
        />

        {entries.map((entry) => (
          <section key={entry.version} className="relative pl-8 md:pl-10">
            {/* glowing node */}
            <span
              aria-hidden
              className="absolute left-0 top-1.5 size-[11px] rounded-full bg-foreground/70 ring-4 ring-background shadow-[0_0_14px_rgba(255,255,255,0.35)]"
            />

            <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
              <h2 className="font-heading text-2xl font-semibold tracking-tight text-foreground">
                {entry.version}
              </h2>
              <span className="text-sm text-muted-foreground/70">
                {entry.date}
              </span>
              {entry.badge ? (
                <span className="rounded-full border border-border bg-card px-2.5 py-0.5 text-xs text-muted-foreground">
                  {entry.badge}
                </span>
              ) : null}
            </div>

            <ul className="mt-5 space-y-3">
              {entry.changes.map((c, i) => {
                const { icon: Icon, className } = tagMeta[c.tag];
                return (
                  <li key={i} className="flex items-start gap-3">
                    <span
                      className={`mt-0.5 inline-flex w-[88px] shrink-0 items-center gap-1.5 rounded-md border px-2 py-0.5 text-xs font-medium ${className}`}
                    >
                      <Icon className="size-3" />
                      {c.tag}
                    </span>
                    <span className="text-sm leading-relaxed text-muted-foreground">
                      {c.text}
                    </span>
                  </li>
                );
              })}
            </ul>
          </section>
        ))}
      </div>
    </PageShell>
  );
}
