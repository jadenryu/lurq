import { cn } from "@/lib/utils";

type Row = { rank: string; name: string; score: string; confidence: string };

const rows: Row[] = [
  { rank: "1", name: "react-hook-form", score: "94", confidence: "proven" },
  { rank: "2", name: "@tanstack/form", score: "81", confidence: "emerging" },
  { rank: "3", name: "formik", score: "76", confidence: "proven" },
];

// Stand-in "product image" for the showcase section: a faux terminal showing
// lurq output. Swap for a real screenshot/asset when available.
export function ProductPanel({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        "relative overflow-hidden rounded-[var(--radius-lg)] border border-border bg-card shadow-2xl shadow-black/50",
        className,
      )}
    >
      {/* title bar */}
      <div className="flex items-center gap-2 border-b border-border px-4 py-3">
        <span className="size-3 rounded-full bg-foreground/15" />
        <span className="size-3 rounded-full bg-foreground/15" />
        <span className="size-3 rounded-full bg-foreground/15" />
        <span className="ml-2 font-mono text-xs text-muted-foreground">
          lurq — recommend
        </span>
      </div>

      {/* body */}
      <div className="space-y-4 p-5 font-mono text-sm md:p-6">
        <p className="text-foreground">
          <span className="text-foreground/40">$ </span>
          lurq recommend{" "}
          <span className="text-muted-foreground">
            &quot;a form library for react&quot;
          </span>
        </p>

        <div className="space-y-2">
          {rows.map((r) => (
            <div
              key={r.name}
              className="flex items-center gap-3 rounded-md border border-border bg-background/50 px-3 py-2.5"
            >
              <span className="w-4 text-muted-foreground/60">{r.rank}</span>
              <span className="flex-1 text-foreground">{r.name}</span>
              <span className="text-muted-foreground">
                score{" "}
                <span className="text-foreground">{r.score}</span>
              </span>
              <span className="rounded-full border border-border px-2 py-0.5 text-[11px] uppercase tracking-wide text-muted-foreground">
                {r.confidence}
              </span>
            </div>
          ))}
        </div>

        <p className="text-xs text-muted-foreground/60">
          dataAsOf 2026-06-22 · scored from npm · github · deps.dev
        </p>
      </div>
    </div>
  );
}
