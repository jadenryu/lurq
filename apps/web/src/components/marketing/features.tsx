import {
  Body,
  ChessBlock,
  Container,
  EmptyArtifact,
  Label,
} from "@/components/marketing/primitives";
import { SurfaceGrid } from "@/components/marketing/surface-grid";
import { VerifyCards } from "@/components/marketing/verify-cards";
import { Pipeline } from "@/components/marketing/pipeline";
import { group, provenance, usageDiff, verifyExample } from "@/lib/marketing-data";

/**
 * The capability sections, alternating text and artifact down the page. Each one
 * leads with the problem rather than the feature, and each artifact is the real
 * output rendered in whatever form suits what it actually is — a grid for a
 * surface, cards for two things being compared, a diagram for a pipeline. The one
 * terminal on the page is the install command, because someone is going to copy
 * that.
 */

// ── usage ────────────────────────────────────────────────────────────────────

function shorten(sig: string | null, max = 54): string {
  if (!sig) return "—";
  const flat = sig.replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}

/** Removals that break at runtime, not at compile time, read hardest. */
const VALUE_KINDS = new Set(["function", "variable", "class", "enum"]);

/**
 * Four lines, not fifty. One of each kind of change, chosen by rule rather than
 * by hand so the examples follow the data if the versions move:
 *   · removed — a runtime value over a type; those break code that compiled
 *   · renamed — the only one there is
 *   · changed — prefer a non-function signature, where the edit is small enough
 *               to read in full rather than being a wall of parameters
 *   · added   — the shortest runtime value, for symmetry with the removal
 */
function examples() {
  const { delta } = usageDiff;
  const byValueFirst = <T extends { kind: string; name: string }>(a: T, b: T) =>
    Number(VALUE_KINDS.has(b.kind)) - Number(VALUE_KINDS.has(a.kind)) ||
    a.name.length - b.name.length;

  const removed = [...delta.removed].sort(byValueFirst)[0] ?? null;
  const added = [...delta.added].sort(byValueFirst)[0] ?? null;
  const renamed = delta.renamed[0] ?? null;
  const changed =
    delta.changed.find((c) => !c.before?.includes("=>") && !c.after?.includes("=>")) ??
    delta.changed[0] ??
    null;

  return { removed, added, renamed, changed };
}

function UsageExamples() {
  const { removed, added, renamed, changed } = examples();

  return (
    <ul className="mt-8 space-y-4 border-t border-rule pt-6">
      {removed ? (
        <Example
          sign="−"
          tone="conflict"
          name={removed.name}
          note={`${removed.kind}, gone`}
        />
      ) : null}
      {renamed ? (
        <Example
          sign="~"
          name={renamed.from.name}
          note={`now called ${renamed.to.name}`}
        />
      ) : null}
      {changed ? (
        <Example
          sign="!"
          name={changed.name}
          note={
            <>
              <span className="text-conflict">{shorten(changed.before)}</span>
              <br />
              <span className="text-verified">{shorten(changed.after)}</span>
            </>
          }
        />
      ) : null}
      {added ? (
        <Example
          sign="+"
          tone="verified"
          name={added.name}
          note={`${added.kind}, new`}
        />
      ) : null}
    </ul>
  );
}

function Example({
  sign,
  name,
  note,
  tone,
}: {
  sign: string;
  name: string;
  note: React.ReactNode;
  tone?: "conflict" | "verified";
}) {
  return (
    <li className="flex gap-3">
      <span
        aria-hidden
        className={
          tone === "conflict"
            ? "t-data w-3 shrink-0 text-conflict"
            : tone === "verified"
              ? "t-data w-3 shrink-0 text-verified"
              : "t-data w-3 shrink-0 text-ink-soft/60"
        }
      >
        {sign}
      </span>
      <span className="min-w-0">
        <span className="t-h3 block text-ink">{name}</span>
        <span className="t-data mt-1 block break-words text-ink-soft">{note}</span>
      </span>
    </li>
  );
}

export function FeatureUsage() {
  const { package: pkg, fromVersion, toVersion } = usageDiff;

  return (
    <ChessBlock
      id="capabilities"
      label="What the model can't know"
      heading="Your agent is writing against last year's API"
      body={
        <>
          <Body>
            The model learned this library from text written before its cutoff. When a
            library ships a breaking major, every one of those texts is wrong, and the
            model has no way to know. It writes clean, confident, non-existent code.
          </Body>
          <Body>
            {/* Not "to the right" — the artifact sits underneath on mobile. */}
            So we read the library instead. Every square in that grid is one export of{" "}
            <span className="font-mono text-ink">{pkg}</span>, taken from the{" "}
            <code className="font-mono text-ink">.d.ts</code> it actually shipped —{" "}
            {fromVersion} against {toVersion}, arithmetic on two lists rather than a
            guess.
          </Body>
        </>
      }
      footnote="parsed from the published type declarations · no model involved"
      artifact={
        usageDiff.cells.length ? (
          <>
            <SurfaceGrid />
            <UsageExamples />
          </>
        ) : (
          <EmptyArtifact what="api diff" />
        )
      }
    />
  );
}

// ── verify ───────────────────────────────────────────────────────────────────

export function FeatureVerify() {
  const typosquat = verifyExample.checks.find((c) => c.result.typosquatOf);
  const big = verifyExample.checks.find(
    (c) => !c.result.typosquatOf && c.result.weeklyDownloads > 1_000_000,
  );

  return (
    <ChessBlock
      flip
      label="What installs cleanly anyway"
      heading="A bad package installs exactly as cleanly as a good one"
      body={
        <>
          <Body>
            A package with an open advisory installs without complaint. So does a
            deprecated one. So does a name that is one keystroke from the one your agent
            meant. Nothing errors, so nothing gets fixed.
          </Body>
          <Body>
            {typosquat ? (
              <>
                <span className="font-mono text-ink">{typosquat.package}</span> is on
                npm right now, {group(typosquat.result.weeklyDownloads)} downloads a
                week, with two letters of{" "}
                <span className="font-mono text-ink">
                  {typosquat.result.typosquatOf}
                </span>{" "}
                traded places.{" "}
              </>
            ) : null}
            {big ? (
              <>
                <span className="font-mono text-ink">{big.package}</span> is the
                opposite problem: {group(big.result.weeklyDownloads)} downloads a week,
                deprecated by its own maintainer, and an open advisory. Size is not
                safety.
              </>
            ) : null}
          </Body>
          <Body>
            The check hits the registry every time, because a hallucinated name is new
            by definition and a cached list would never have heard of it.
          </Body>
        </>
      }
      footnote="checked against the live registry, not a cached list"
      artifact={<VerifyCards />}
    />
  );
}

// ── provenance ───────────────────────────────────────────────────────────────

/**
 * Full width rather than a chess block: a diagram wants room, and squeezed into
 * half a column the source labels shrink to eight pixels and stop being readable.
 */
export function FeatureProvenance() {
  return (
    <section className="border-t border-rule py-16 md:py-28">
      <Container>
        <Label>Where the numbers come from</Label>

        <div className="grid gap-8 lg:grid-cols-12">
          <h2 className="t-h2 max-w-[24ch] text-balance text-ink lg:col-span-4">
            Every figure on this page has a receipt
          </h2>

          <div className="space-y-4 lg:col-span-7 lg:col-start-6">
            <Body>
              Every field on a package points at the request that produced it. Nothing
              is hand-picked, nothing is written by a model, and every answer carries
              the timestamp it was read at — so a stale number is visible as a stale
              number rather than passing as a current one.
            </Body>
            <Body>
              {group(provenance.versionsTracked)} versions in the timeline, a sync that
              has run {provenance.syncDays} days, and{" "}
              {group(provenance.coOccurrencePairs)} package pairs recorded as resolving
              together in public dependency graphs. That last figure is co-occurrence,
              not a verified install, and it is never counted as one.
            </Body>
            <details className="border-t border-rule pt-4">
              <summary className="t-data cursor-pointer text-ink-soft transition-colors duration-[120ms] hover:text-mark">
                what each endpoint contributes
              </summary>
              <dl className="mt-3 space-y-2">
                {provenance.sources.map((s) => (
                  <div key={s.name} className="flex flex-wrap gap-x-3">
                    <dt className="t-data w-[9.5rem] shrink-0 text-ink">{s.name}</dt>
                    <dd className="t-data min-w-0 flex-1 text-ink-soft">
                      {s.contributes}
                    </dd>
                  </div>
                ))}
              </dl>
            </details>
          </div>
        </div>

        <div className="mt-12 hidden sm:block">
          <Pipeline />
        </div>
        <p className="t-data mt-6 text-ink-soft">
          every source is a public endpoint · re-run the generator and the page moves
        </p>
      </Container>
    </section>
  );
}
