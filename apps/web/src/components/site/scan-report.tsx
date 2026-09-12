import Link from "next/link";
import type { PublicScan, ScanDep } from "@/lib/public-scan";
import { FREE_DEPS } from "@/lib/public-scan";

/**
 * The full public report for one repo, at /scan/[owner]/[repo].
 *
 * THE GATE IS PAST WHAT THEY ALREADY HAD, NEVER OVER IT. The hero box shows
 * eight dependency rows to anyone, so this page shows the same eight sharp and
 * blurs the tail. A visitor who scanned, liked the answer and clicked through
 * must never arrive at less than they were already given: that reads as a
 * bait-and-switch, and it is the one version of this page that would cost
 * sign-ups rather than earn them.
 *
 * WHAT IS BLURRED IS REAL. The blurred rows are the same computed rows, not
 * skeleton placeholders, and the counts above them are exact and sharp. A
 * product whose entire pitch is "evidence, not vibes" cannot put invented
 * content behind its own paywall, and the reveal after sign-up has to match
 * the shape the visitor was looking at or the sign-up feels spent, not repaid.
 *
 * ponytail: a CSS blur over real data in the DOM, so devtools defeats it. That
 * is the correct trade — the rows are public npm facts about a public repo, the
 * gate is a conversion affordance rather than a security boundary, and anybody
 * reading the DOM to dodge a free account was never going to make one. Move the
 * slice server-side only if this page ever carries something private.
 *
 * WHY SIGN-UP IS WORTH IT IS SAID IN NUMBERS THE VISITOR CAN SEE. "Sign in to
 * see more" is a wall. "41 more dependencies and 3 conflicts" is the rest of a
 * thing they are already reading, and the count comes from their own repo.
 */

/** One number and what it counts. */
function Tile({ n, label, hot }: { n: number; label: string; hot?: boolean }) {
  return (
    <div className="min-w-0">
      <p
        className="font-sans text-[30px] font-medium leading-none tracking-[-0.02em]"
        style={{ color: hot && n > 0 ? "var(--rail)" : "var(--ink)" }}
      >
        {n}
      </p>
      <p className="mt-2 text-[12px] leading-[1.35] text-ink-3">{label}</p>
    </div>
  );
}

/** The worst thing true about one dependency, in the fewest words. */
function verdict(dep: ScanDep): { text: string; tone: string } {
  if (dep.advisories > 0) {
    return {
      text: `${dep.advisories} ${dep.advisories === 1 ? "advisory" : "advisories"}`,
      tone: "var(--rail)",
    };
  }
  if (dep.deprecated) return { text: "deprecated", tone: "var(--rail)" };
  if (dep.majorsBehind > 0) {
    return { text: `${dep.majorsBehind} major behind`, tone: "var(--ink-2)" };
  }
  return { text: "current", tone: "var(--ink-3)" };
}

function DepRow({ dep }: { dep: ScanDep }) {
  const v = verdict(dep);
  return (
    <li className="flex items-baseline gap-3 border-b border-edge px-5 py-2.5 last:border-b-0">
      <span className="truncate font-mono text-[12.5px] text-ink">{dep.name}</span>
      <span className="shrink-0 font-mono text-[11.5px] text-ink-3">
        {dep.resolved ?? dep.range}
        {dep.latest && dep.latest !== dep.resolved ? ` → ${dep.latest}` : ""}
      </span>
      <span className="ml-auto shrink-0 font-mono text-[11px]" style={{ color: v.tone }}>
        {v.text}
      </span>
    </li>
  );
}

/**
 * The sign-up ask, stated as the rest of the page rather than as a wall.
 *
 * `redirect_url` brings them back HERE, to the report they were reading, with
 * the blur gone. Sending them to an empty dashboard instead is the version of
 * this flow that converts and then churns: they paid with an account and the
 * thing they paid for was not on the other side.
 */
function Gate({ scan, hiddenDeps }: { scan: PublicScan; hiddenDeps: number }) {
  const back = `/scan/${scan.repo}`;
  const bits: string[] = [];
  if (hiddenDeps > 0) {
    bits.push(`${hiddenDeps} more ${hiddenDeps === 1 ? "dependency" : "dependencies"}`);
  }
  if (scan.conflictDetail.length > 0) {
    bits.push(
      `${scan.conflictDetail.length} ${scan.conflictDetail.length === 1 ? "conflict" : "conflicts"} written out`,
    );
  }

  return (
    <div className="border-t border-edge bg-surface-2 px-5 py-5">
      <p className="text-[14px] leading-[1.5] text-ink">
        {/* A small repo with nothing behind the blur still gets an ask, and it
            has to be a different one. Promising "the rest" when there is no
            rest is the kind of copy that converts once and is never trusted
            again — here the offer is the thing this page cannot do at all:
            keep looking after you close the tab. */}
        {bits.length > 0
          ? `${bits.join(" and ")}, in this repo.`
          : "This page is one look. lurq keeps looking."}
      </p>
      <p className="mt-1.5 text-[12.5px] leading-[1.55] text-ink-3">
        {bits.length > 0
          ? "Free account. Nothing to install, and you land back on this page."
          : "Connect the repo and lurq reads every manifest in it, then tells you when an upgrade would break something."}
      </p>
      <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2">
        <Link
          href={`/sign-up?redirect_url=${encodeURIComponent(back)}`}
          className="inline-flex h-10 items-center rounded-full bg-mark px-5 text-[13.5px] font-medium text-ground transition-opacity hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-mark"
        >
          Show me the rest
        </Link>
        <Link
          href={`/sign-in?redirect_url=${encodeURIComponent(back)}`}
          className="text-[12.5px] text-ink-3 underline-offset-4 hover:text-ink hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-mark"
        >
          I already have an account
        </Link>
      </div>
    </div>
  );
}

function Conflicts({ conflicts }: { conflicts: PublicScan["conflictDetail"] }) {
  return (
    <ul className="border-t border-edge">
      {conflicts.map((c, i) => (
        <li key={`${c.source}-${i}`} className="border-b border-edge px-5 py-3 last:border-b-0">
          <p className="font-mono text-[12px] text-ink">{c.packages.join(" · ")}</p>
          <p className="mt-1 text-[12.5px] leading-[1.5] text-ink-2">{c.detail}</p>
          <p className="mt-1 font-mono text-[10.5px] uppercase tracking-[0.08em] text-ink-3">
            {c.source}
          </p>
        </li>
      ))}
    </ul>
  );
}

export function ScanReport({ scan, signedIn }: { scan: PublicScan; signedIn: boolean }) {
  const untracked = scan.depsDeclared - scan.depsTracked;
  const shown = signedIn ? scan.deps : scan.deps.slice(0, FREE_DEPS);
  const hidden = signedIn ? [] : scan.deps.slice(FREE_DEPS);

  return (
    <div className="overflow-hidden rounded-xl border border-edge border-t-edge-lit bg-surface text-left">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-edge bg-surface-2 px-5 py-3.5">
        <a
          href={scan.url}
          target="_blank"
          rel="noopener"
          className="font-mono text-[13px] text-ink transition-colors hover:text-mark focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-mark"
        >
          {scan.repo}
        </a>
        {/* Said out loud, every time. The root manifest is not the repo, and a
            partial count that reads as complete is the one number this whole
            product exists to argue against. */}
        <span className="ml-auto font-mono text-[11px] text-ink-3">
          root package.json{untracked > 0 ? ` · ${untracked} not indexed yet` : ""}
        </span>
      </div>

      {scan.depsTracked === 0 ? (
        <p className="px-5 py-6 text-[13.5px] leading-[1.6] text-ink-2">
          Nothing in that manifest is in the index yet. It has been queued, so the same scan in a
          few minutes will have something to say.
        </p>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-y-6 px-5 py-6 min-[560px]:grid-cols-4">
            <Tile n={scan.depsTracked} label="dependencies read" />
            <Tile n={scan.majorDrift} label="a major behind" hot />
            <Tile n={scan.advisories} label="advisories" hot />
            <Tile n={scan.conflicts} label="conflicts at latest" hot />
          </div>

          <ul className="border-t border-edge">
            {shown.map((dep) => (
              <DepRow key={dep.name} dep={dep} />
            ))}
          </ul>

          {hidden.length > 0 && (
            // aria-hidden + inert: blurred text is unreadable but a screen
            // reader would happily announce every row, which would hand the
            // gated content to assistive tech and nobody else. The counts and
            // the ask above it are the accessible version of this block.
            <ul aria-hidden className="pointer-events-none select-none border-t border-edge">
              {hidden.map((dep) => (
                <li key={dep.name} className="blur-[5px]">
                  <DepRow dep={dep} />
                </li>
              ))}
            </ul>
          )}

          {scan.conflictDetail.length > 0 &&
            (signedIn ? (
              <Conflicts conflicts={scan.conflictDetail} />
            ) : (
              <div aria-hidden className="pointer-events-none select-none blur-[5px]">
                <Conflicts conflicts={scan.conflictDetail} />
              </div>
            ))}
        </>
      )}

      {signedIn ? (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-edge bg-surface-2 px-5 py-4">
          <p className="text-[12.5px] leading-[1.5] text-ink-2">
            This read the root manifest. Connect the repo and lurq reads every manifest in it, and
            tells you when an upgrade would break something.
          </p>
          <Link
            href={`/dashboard/repos?scan=${encodeURIComponent(scan.repo)}`}
            className="ml-auto shrink-0 text-[12.5px] font-medium text-mark underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-mark"
          >
            Connect this repo
          </Link>
        </div>
      ) : (
        <Gate scan={scan} hiddenDeps={hidden.length} />
      )}
    </div>
  );
}
