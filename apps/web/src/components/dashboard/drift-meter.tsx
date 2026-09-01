import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { Panel, eyebrow } from "@/components/dashboard/panel";

/**
 * Where the dependency set stands: behind, current, or never looked at.
 *
 * This replaced an "advisories" tile that was a false zero, lurq records 27
 * advisories across 11,333 indexed packages, most of them typosquats rather
 * than CVEs, so a project with hundreds of dependencies read `0 advisories`,
 * which a person correctly hears as "nothing to worry about". That is a claim
 * about their codebase made from data we do not have.
 *
 * The first version of this tile then made the opposite mistake, and a worse
 * one: it showed `behind / tracked`, a single share over the subset lurq had
 * indexed, with the unindexed remainder nowhere on screen. RepoDrift is
 * explicit that those are not the same number, `depsTracked` is "how many of
 * those lurq has indexed. The rest are `unknown`, never silently counted as
 * current", and CoverageCell in repos-panel.tsx spells out the rule this broke:
 * collapsing coverage into one percentage lets the dashboard imply an all-clear
 * it did not earn.
 *
 * So the denominator is what the manifests DECLARE, and unknown is a third
 * state with its own width. A reader can see at a glance that a quiet bar might
 * be a clean project or an unread one, which is the honest thing for it to say.
 * The two data colours are the drift board's --held and --conflict, so the same
 * measurement looks the same before and after signing in.
 */
export function DriftMeter({
  behind,
  tracked,
  declared,
  deprecated,
  href,
}: {
  /** Tracked dependencies at least one major behind. */
  behind: number;
  /** Dependencies lurq has indexed: the assessed set. */
  tracked: number;
  /** Dependencies the manifests declare, the real denominator. */
  declared: number;
  deprecated: number;
  /** Where the counted rows live. Omitted → the tile stays inert. */
  href?: string;
}) {
  const total = Math.max(declared, tracked, 1);
  const unknown = Math.max(0, declared - tracked);
  const current = Math.max(0, tracked - behind);
  const pct = (n: number) => (n / total) * 100;

  const body = (
    <>
      <div className="flex items-start justify-between gap-2">
        <p className={eyebrow}>behind by a major</p>
        {href && (
          <ChevronRight
            aria-hidden
            className="size-3.5 shrink-0 -translate-x-1 text-ink-3 opacity-0 transition-all duration-150 group-hover:translate-x-0 group-hover:opacity-100 group-focus-visible:translate-x-0 group-focus-visible:opacity-100"
          />
        )}
      </div>

      <div className="mt-3">
        <p className="font-sans text-2xl font-medium tracking-[-0.02em] text-ink md:text-3xl">
          {behind.toLocaleString()}
          <span className="text-ink-3"> of {tracked.toLocaleString()}</span>
        </p>
        <p className="mt-1 font-mono text-[0.65rem] text-ink-3">
          {unknown > 0 ? `${unknown.toLocaleString()} not indexed` : "all declared deps indexed"}
          {deprecated > 0 && ` · ${deprecated} deprecated`}
        </p>
      </div>

      {/* Three states, no legend: the widths are the label. Unknown is drawn in
          the panel's own border colour rather than a status hue, because it is
          the absence of a verdict and must not read as one. */}
      <div
        className="mt-3 flex h-1 w-full gap-px overflow-hidden rounded-full bg-edge"
        role="img"
        aria-label={
          `${behind} of ${tracked} indexed dependencies are at least one major behind` +
          (unknown > 0 ? `; ${unknown} of ${declared} declared are not indexed` : "")
        }
      >
        {/* Native title per segment. The bar's aria-label already reads the
            whole sentence for assistive tech, but a sighted reader hovering the
            red slice had no way to learn which slice it was — the widths are
            the label only once you already know the encoding. */}
        {behind > 0 && (
          <span
            title={`${behind.toLocaleString()} behind by a major`}
            style={{ width: `${pct(behind)}%`, background: "var(--conflict)" }}
          />
        )}
        {current > 0 && (
          <span
            title={`${current.toLocaleString()} on a current major`}
            style={{ width: `${pct(current)}%`, background: "var(--held)", opacity: 0.4 }}
          />
        )}
        {unknown > 0 && (
          <span
            title={`${unknown.toLocaleString()} declared but not yet indexed`}
            style={{ width: `${pct(unknown)}%`, background: "var(--edge-lit)" }}
          />
        )}
      </div>
    </>
  );

  if (!href) {
    return (
      <Panel padding="tight" className="flex flex-col justify-between">
        {body}
      </Panel>
    );
  }

  return (
    <Link
      href={href}
      className="group rounded-[var(--radius-panel)] outline-none transition-transform duration-150 hover:-translate-y-px focus-visible:ring-2 focus-visible:ring-signal/50 focus-visible:ring-offset-2 focus-visible:ring-offset-bg motion-reduce:hover:translate-y-0 motion-reduce:transition-none"
    >
      <Panel
        padding="tight"
        className="flex h-full flex-col justify-between transition-colors duration-150 group-hover:border-edge-lit"
      >
        {body}
      </Panel>
    </Link>
  );
}
