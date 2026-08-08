import { Chip, EmptyState, Panel, PanelHeader } from "@/components/dashboard/panel";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { TransitiveRisk, TransitiveSummary } from "@/lib/lurq-issuer";

/**
 * The tree beneath the manifest.
 *
 * Two pieces of restraint hold this panel together:
 *
 * 1. It says "packages with known advisories", never "vulnerable dependencies".
 *    lurq records advisories against a package, not against a version range, so
 *    claiming the *installed* version is affected would be an inference we can't
 *    back. The honest version is still useful — these were invisible before.
 *
 * 2. A repo with the dependency graph switched off renders as "not read", not as
 *    a clean tree. Silence has to look different from an all-clear.
 */
export function TransitiveRiskPanel({
  summary,
  risks,
}: {
  summary: TransitiveSummary | null;
  risks: TransitiveRisk[];
}) {
  if (!summary) {
    return (
      <EmptyState title="Transitive dependencies not read">
        This repository has GitHub&rsquo;s dependency graph turned off, so lurq could not see
        past its <code className="font-mono text-xs">package.json</code>. The drift figures above
        cover direct dependencies only. Enable it under Settings → Security to include the
        resolved tree.
      </EmptyState>
    );
  }

  const untracked = summary.resolved - summary.tracked;

  return (
    <div className="space-y-4">
      <PanelHeader
        title="transitive dependencies"
        trailing={
          <span className="font-mono text-xs text-muted-foreground">
            {summary.resolved.toLocaleString()} resolved
            {untracked > 0 && ` · ${untracked.toLocaleString()} not indexed`}
          </span>
        }
      />

      <p className="max-w-2xl text-sm leading-relaxed text-muted-foreground">
        Packages your dependencies pull in, which no manifest declares. These carry exact
        installed versions rather than ranges. An advisory here is recorded against the{" "}
        <em>package</em>, not proven against the installed version — and it is usually fixed by
        upgrading whatever depends on it, not by editing your own manifest.
      </p>

      {risks.length === 0 ? (
        <Panel padding="tight">
          <p className="text-sm text-muted-foreground">
            {summary.tracked === 0
              ? "None of the resolved tree is in the lurq index yet, so there is no signal either way."
              : `No advisories or deprecations among the ${summary.tracked.toLocaleString()} indexed packages in the tree.`}
          </p>
        </Panel>
      ) : (
        <Panel padding="none" className="overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow className="border-border">
                <TableHead className="pl-5 md:pl-6">package</TableHead>
                <TableHead>installed</TableHead>
                <TableHead>latest</TableHead>
                <TableHead className="pr-5 md:pr-6">signal</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {risks.map((risk) => (
                <TableRow key={`${risk.name}@${risk.version}`} className="border-border">
                  <TableCell className="pl-5 font-mono text-sm md:pl-6">{risk.name}</TableCell>
                  <TableCell className="font-mono text-xs tabular-nums">{risk.version}</TableCell>
                  <TableCell className="font-mono text-xs tabular-nums text-muted-foreground">
                    {risk.latest ?? "—"}
                  </TableCell>
                  <TableCell className="pr-5 md:pr-6">
                    <span className="flex flex-wrap items-center gap-1.5">
                      {risk.advisories > 0 && (
                        <Chip tone="bad">
                          {risk.advisories} advisor{risk.advisories === 1 ? "y" : "ies"} on package
                        </Chip>
                      )}
                      {risk.deprecated && <Chip tone="warn">deprecated</Chip>}
                    </span>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Panel>
      )}

      {summary.truncated && (
        <p className="font-mono text-xs text-muted-foreground/70">
          The resolved tree was larger than lurq reads in one pass, so these figures are a lower
          bound.
        </p>
      )}
    </div>
  );
}
