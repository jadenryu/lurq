import { Panel, eyebrow } from "@/components/dashboard/panel";

/**
 * How much of the dependency set has moved on without you.
 *
 * This replaced an "advisories" tile that was structurally a false zero. lurq
 * records 27 advisories across 11,333 indexed packages, and the ones it has are
 * mostly typosquats (`lodahs`, `momnet`) rather than CVEs — so a real project
 * with 367 dependencies reads `0 advisories`, which a person correctly hears as
 * "nothing to worry about". That is a claim about a codebase's safety made from
 * data lurq does not have, and it is the same failure as reporting an upgrade
 * OK because the only symbol checked happened to survive.
 *
 * A share is honest in a way a count is not: it says what was measured as well
 * as what was found. 117 of 367 is a sentence about coverage AND about risk;
 * `0` is a sentence about neither.
 *
 * The bar borrows the drift board's vocabulary deliberately — --held for what
 * still holds, --conflict for what has moved — so a number seen on the
 * marketing page and the same number seen after signing in are visibly the same
 * measurement, not two dashboards that happen to share a brand.
 */
export function DriftMeter({
  behind,
  tracked,
  deprecated,
}: {
  /** Dependencies at least one major behind. */
  behind: number;
  /** Dependencies lurq has version history for — the real denominator. */
  tracked: number;
  deprecated: number;
}) {
  const share = tracked > 0 ? behind / tracked : 0;
  const pct = Math.round(share * 100);

  return (
    <Panel padding="tight" className="flex flex-col justify-between">
      <p className={eyebrow}>behind by a major</p>

      <div className="mt-3">
        <p className="font-sans text-2xl font-medium tracking-[-0.02em] text-ink md:text-3xl">
          {pct}
          <span className="text-ink-3">%</span>
        </p>
        <p className="mt-1 font-mono text-[0.65rem] text-ink-3">
          {behind.toLocaleString()} of {tracked.toLocaleString()} tracked
          {deprecated > 0 && ` · ${deprecated} deprecated`}
        </p>
      </div>

      {/* One bar, two states, no legend: the width IS the label, and the two
          colours already mean this on the drift board. Sized off the same
          share the figure above states, so they cannot disagree. */}
      <div
        className="mt-3 flex h-1 w-full overflow-hidden rounded-full bg-edge"
        role="img"
        aria-label={`${behind} of ${tracked} tracked dependencies are at least one major behind`}
      >
        <span
          className="h-full rounded-full transition-[width] duration-500"
          style={{ width: `${Math.max(share > 0 ? 2 : 0, pct)}%`, background: "var(--conflict)" }}
        />
        <span className="h-full flex-1" style={{ background: "var(--held)", opacity: 0.35 }} />
      </div>
    </Panel>
  );
}
