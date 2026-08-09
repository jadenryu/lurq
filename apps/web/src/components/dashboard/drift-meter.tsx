import { Panel, eyebrow } from "@/components/dashboard/panel";

/**
 * Where the dependency set stands: behind, current, or never looked at.
 *
 * This replaced an "advisories" tile that was a false zero — lurq records 27
 * advisories across 11,333 indexed packages, most of them typosquats rather
 * than CVEs, so a project with hundreds of dependencies read `0 advisories`,
 * which a person correctly hears as "nothing to worry about". That is a claim
 * about their codebase made from data we do not have.
 *
 * The first version of this tile then made the opposite mistake, and a worse
 * one: it showed `behind / tracked`, a single share over the subset lurq had
 * indexed, with the unindexed remainder nowhere on screen. RepoDrift is
 * explicit that those are not the same number — `depsTracked` is "how many of
 * those lurq has indexed. The rest are `unknown` — never silently counted as
 * current" — and CoverageCell in repos-panel.tsx spells out the rule this broke:
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
}: {
  /** Tracked dependencies at least one major behind. */
  behind: number;
  /** Dependencies lurq has indexed — the assessed set. */
  tracked: number;
  /** Dependencies the manifests declare — the real denominator. */
  declared: number;
  deprecated: number;
}) {
  const total = Math.max(declared, tracked, 1);
  const unknown = Math.max(0, declared - tracked);
  const current = Math.max(0, tracked - behind);
  const pct = (n: number) => (n / total) * 100;

  return (
    <Panel padding="tight" className="flex flex-col justify-between">
      <p className={eyebrow}>behind by a major</p>

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
        {behind > 0 && (
          <span style={{ width: `${pct(behind)}%`, background: "var(--conflict)" }} />
        )}
        {current > 0 && (
          <span style={{ width: `${pct(current)}%`, background: "var(--held)", opacity: 0.4 }} />
        )}
        {unknown > 0 && <span style={{ width: `${pct(unknown)}%`, background: "var(--edge-lit)" }} />}
      </div>
    </Panel>
  );
}
