"use client";

import { group, verifyExample } from "@/lib/marketing-data";
import { cn } from "@/lib/utils";

/**
 * Two inspection cards rather than two terminal dumps.
 *
 * The point of this pair is the contrast — a package nobody has heard of that is
 * pretending to be one everybody has, next to one everybody depends on that
 * still shouldn't be installed. Rendering both as the same block of monospace
 * output loses exactly that.
 */

type Check = (typeof verifyExample.checks)[number];

/**
 * Where a typosquat swapped two adjacent characters. Derived from the pair the
 * checker actually reported, so it can't drift from the data: find the first
 * differing index and confirm that swapping it with its neighbour reconciles the
 * two names.
 */
function transposition(real: string, fake: string): number | null {
  if (real.length !== fake.length) return null;
  for (let i = 0; i < real.length - 1; i++) {
    if (real[i] === fake[i]) continue;
    const swapped = real.slice(0, i) + real[i + 1] + real[i] + real.slice(i + 2);
    return swapped === fake ? i : null;
  }
  return null;
}

export function VerifyCards() {
  const checks = verifyExample.checks;
  const typosquat = checks.find((c) => c.result.typosquatOf);
  const rest = checks.filter((c) => c !== typosquat);

  return (
    <div className="grid gap-4 sm:grid-cols-2">
      {typosquat ? <TyposquatCard check={typosquat} /> : null}
      {rest.map((c) => (
        <PlainCard key={c.package} check={c} />
      ))}
    </div>
  );
}

function Card({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn("flex flex-col rounded border border-rule bg-paper p-5", className)}
    >
      {children}
    </div>
  );
}

function Verdict({ risk }: { risk: string }) {
  const high = risk === "high";
  return (
    <p
      className={cn(
        "t-label flex items-center gap-1.5",
        high ? "text-conflict" : "text-ink-soft",
      )}
    >
      <span aria-hidden>{high ? "✗" : "⚠"}</span>
      {high ? "high supply-chain risk" : "exists, but risky"}
    </p>
  );
}

function Facts({ check }: { check: Check }) {
  const { result } = check;
  return (
    <>
      <dl className="mt-5 space-y-3 border-t border-rule pt-4">
        <Fact label="weekly downloads" value={group(result.weeklyDownloads)} />
        <Fact label="latest version" value={result.latestVersion ?? "—"} />
        <Fact
          label="advisories"
          value={String(result.advisoryCount)}
          tone={result.advisoryCount > 0 ? "conflict" : undefined}
        />
      </dl>

      <ul className="mt-4 flex flex-wrap gap-1.5">
        {result.riskFlags.map((flag) => (
          <li
            key={flag}
            className="rounded border border-conflict/40 px-1.5 py-1 font-mono text-[0.6875rem] text-conflict"
          >
            {flag}
          </li>
        ))}
      </ul>
    </>
  );
}

function Fact({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: "conflict";
}) {
  // Stacked, not label-left-value-right: these cards sit two-up in half a column,
  // and a two-column row turns `0.0.1-security` into three wrapped lines.
  return (
    <div>
      <dt className="t-label">{label}</dt>
      <dd
        className={cn(
          "mt-1 font-mono text-[0.9375rem]",
          tone === "conflict" ? "text-conflict" : "text-ink",
        )}
      >
        {value}
      </dd>
    </div>
  );
}

/**
 * The typosquat, with the two transposed characters marked.
 *
 * This used to animate the letters trading places. It read as a trick; the fact
 * itself — that two adjacent characters of a name you trust are swapped — lands
 * harder sitting still, in vermilion, next to the download count.
 */
function TyposquatCard({ check }: { check: Check }) {
  const fake = check.package;
  const real = check.result.typosquatOf!;
  const at = transposition(real, fake);

  return (
    <Card>
      <Verdict risk={check.result.risk} />
      <p
        className="mt-4 font-mono text-[1.75rem] leading-none tracking-tight"
        aria-label={`${fake}, a typosquat of ${real}`}
      >
        {fake.split("").map((char, i) => (
          <span
            key={i}
            className={
              at !== null && (i === at || i === at + 1) ? "text-conflict" : "text-ink"
            }
          >
            {char}
          </span>
        ))}
      </p>
      <p className="t-data mt-3 text-ink-soft">
        {at === null ? (
          <>one edit away from {real}</>
        ) : (
          <>
            two letters of <span className="text-ink">{real}</span>, swapped
          </>
        )}
      </p>
      <Facts check={check} />
    </Card>
  );
}

/** The real, enormous, deprecated one. */
function PlainCard({ check }: { check: Check }) {
  return (
    <Card>
      <Verdict risk={check.result.risk} />
      <p className="mt-4 font-mono text-[1.75rem] leading-none tracking-tight text-ink">
        {check.package}
      </p>
      <p className="t-data mt-3 text-ink-soft">
        {check.result.deprecated
          ? "deprecated by its own maintainer"
          : "flagged on the registry"}
        {check.result.weeklyDownloads > 1_000_000 ? " · and still this big" : ""}
      </p>
      <Facts check={check} />
    </Card>
  );
}
