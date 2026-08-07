import { Chip, EmptyState, Panel, PanelHeader, eyebrow } from "@/components/dashboard/panel";
import type { RepoBrief, UpgradeBrief, UpgradeVerdict } from "@/lib/lurq-issuer";
import { cn } from "@/lib/utils";

/**
 * Verdict copy is the most carefully worded text in the product.
 *
 * lurq computes this from the packages alone — it knows the upgrade *removes*
 * `useHistory`, not that this repo *calls* it. So the headline says "removes 6
 * exports", never "breaks 6 call sites". The narrowing to real call sites
 * happens in CI, where the source is, and it is the one claim that would cost us
 * the user's trust if we made it a version early.
 */
const VERDICTS: Record<
  UpgradeVerdict,
  { label: string; tone: "bad" | "warn" | "good" | "neutral" }
> = {
  "removes-exports": { label: "removes exports", tone: "bad" },
  "arity-changed": { label: "signature change", tone: "warn" },
  clean: { label: "no removals", tone: "good" },
  unknown: { label: "not yet analysed", tone: "neutral" },
};

function SymbolList({
  label,
  symbols,
  tone,
}: {
  label: string;
  symbols: string[];
  tone: "bad" | "warn" | "muted";
}) {
  if (symbols.length === 0) return null;
  return (
    <div>
      <p className={eyebrow}>
        {label} · {symbols.length}
      </p>
      <div className="mt-2 flex flex-wrap gap-1.5">
        {symbols.map((symbol) => (
          <code
            key={symbol}
            className={cn(
              "rounded-[var(--radius-chip)] border px-1.5 py-0.5 font-mono text-xs",
              tone === "bad" && "border-bad/30 text-bad",
              tone === "warn" && "border-warn/30 text-warn",
              tone === "muted" && "border-border text-muted-foreground",
            )}
          >
            {symbol}
          </code>
        ))}
      </div>
    </div>
  );
}

function BriefCard({ upgrade }: { upgrade: UpgradeBrief }) {
  const verdict = VERDICTS[upgrade.verdict];
  const detailed =
    upgrade.removed.length > 0 ||
    upgrade.arityChanged.length > 0 ||
    upgrade.typeOnlyRemoved.length > 0 ||
    upgrade.newlyDeprecated.length > 0;

  return (
    <Panel padding="tight">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-2">
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <span className="font-mono text-sm">{upgrade.package}</span>
          <span className="font-mono text-xs tabular-nums text-muted-foreground">
            {upgrade.fromVersion} <span className="text-muted-foreground/50">→</span>{" "}
            {upgrade.toVersion}
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          {upgrade.advisories > 0 && (
            <Chip tone="bad">
              {upgrade.advisories} advisor{upgrade.advisories === 1 ? "y" : "ies"}
            </Chip>
          )}
          {upgrade.deprecated && <Chip tone="warn">deprecated</Chip>}
          <Chip tone={verdict.tone}>{verdict.label}</Chip>
        </div>
      </div>

      {upgrade.inconclusive && (
        <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
          {upgrade.inconclusive}
        </p>
      )}

      {detailed && (
        <div className="mt-4 space-y-4 border-t border-border pt-4">
          <SymbolList label="removed at runtime" symbols={upgrade.removed} tone="bad" />
          {upgrade.arityChanged.length > 0 && (
            <div>
              <p className={eyebrow}>parameter count changed · {upgrade.arityChanged.length}</p>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {upgrade.arityChanged.map((change) => (
                  <code
                    key={change.path}
                    className="rounded-[var(--radius-chip)] border border-warn/30 px-1.5 py-0.5 font-mono text-xs text-warn"
                  >
                    {change.path}
                    <span className="ml-1 text-muted-foreground">
                      {change.from ?? "?"}→{change.to ?? "?"}
                    </span>
                  </code>
                ))}
              </div>
            </div>
          )}
          <SymbolList
            label="newly deprecated"
            symbols={upgrade.newlyDeprecated}
            tone="warn"
          />
          {/* Type-only removals break `tsc`, never `node`. Kept visually separate
              so a red "removed" list is never diluted by compile-time-only noise. */}
          <SymbolList
            label="type-only removals (breaks tsc, not node)"
            symbols={upgrade.typeOnlyRemoved}
            tone="muted"
          />
        </div>
      )}

      {upgrade.verdict === "clean" && (
        <p className="mt-3 text-sm text-muted-foreground">
          Both surfaces compared — nothing this package exports was removed or re-shaped.
        </p>
      )}
    </Panel>
  );
}

export function MigrationBrief({ brief, failed }: { brief: RepoBrief; failed: boolean }) {
  if (failed) {
    return (
      <EmptyState title="Migration brief unavailable">
        The surface index could not be reached. Drift figures above are unaffected — they come
        from the last scan.
      </EmptyState>
    );
  }

  if (brief.upgrades.length === 0) {
    return (
      <EmptyState title="Nothing to upgrade">
        Every indexed dependency in this repository already resolves to its latest release.
      </EmptyState>
    );
  }

  const hazards = brief.upgrades.filter(
    (u) => u.verdict === "removes-exports" || u.verdict === "arity-changed",
  ).length;

  return (
    <div className="space-y-4">
      <PanelHeader
        title="migration brief"
        trailing={
          <span className="font-mono text-xs text-muted-foreground">
            {hazards} of {brief.upgrades.length} change the public API
          </span>
        }
      />

      <p className="max-w-2xl text-sm leading-relaxed text-muted-foreground">
        What each upgrade removes from the package&rsquo;s public surface, extracted from the
        shipped types — not inferred. Whether your code calls any of these symbols is resolved in
        your CI, where the source is.
      </p>

      <div className="space-y-3">
        {brief.upgrades.map((upgrade) => (
          <BriefCard key={upgrade.package} upgrade={upgrade} />
        ))}
      </div>

      {/* Never let a cap read as complete coverage. */}
      {(brief.omitted > 0 || brief.pending > 0) && (
        <p className="font-mono text-xs text-muted-foreground/70">
          {brief.omitted > 0 && `${brief.omitted} further upgrade(s) not shown. `}
          {brief.pending > 0 &&
            `${brief.pending} awaiting surface extraction — queued, and they fill in on the next visit.`}
        </p>
      )}
    </div>
  );
}
