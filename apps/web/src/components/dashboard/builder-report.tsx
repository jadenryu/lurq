"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { SignInButton, SignUpButton, useAuth } from "@clerk/nextjs";
import { ChevronRight, Download, Eye, Lock, RefreshCw } from "lucide-react";
import posthog from "posthog-js";
import { buttonVariants } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { INSTALL_COMMAND } from "@/content/copy";
import { CopyButton, CopyInline } from "@/components/dashboard/copy-button";
import {
  conflictBrief,
  depBrief,
  namesPackage,
  packageImpact,
  repoBrief,
  reportBrief,
  sharedPackages,
  summarize,
  archetypeLine,
  mcpServerLabel,
  mcpToolPower,
  mcpToolSummary,
  depLabel,
  depStatus,
  savedDaysAgo,
  type PackageImpact,
  type SummaryPoint,
} from "@/lib/builder-brief";
import {
  Chip,
  EmptyState,
  InlineError,
  Panel,
  PanelHeader,
  microLabel,
} from "@/components/dashboard/panel";
import { StatRow, StatTile } from "@/components/dashboard/stat-tile";
import {
  ARCHETYPES,
  type BuilderReport,
  type DepDetail,
  type DepDiff,
  type RepoStack,
  type ScanConflict,
  type BuilderStanding,
  type ProfileMcpServer,
  type SavedBuilderScan,
  type StandingMetricId,
  type ScanDep,
  type Trait,
  UPKEEP_AXES,
} from "@/lib/builder-profile";
import { compact, relativeTime } from "@/lib/format";
import { cn } from "@/lib/utils";

/**
 * The builder report, rendered from /api/scan.
 *
 * The API decides what a session receives; this component only renders what
 * came back, and renders `locked` counts as the ask. It never hides anything
 * itself, so there is nothing here for devtools to undo.
 *
 * Client-side rather than a server fetch for two reasons. A profile scan takes
 * seconds on a cold cache, and a server render would hold the whole page (nav
 * included) on a skeleton for all of it. And signing up happens in a modal on
 * this page: when the session appears, the report refetches and the layout
 * refreshes so the nav unlocks, with no navigation at all.
 */

type Outcome =
  | { kind: "failed"; message: string }
  | { kind: "done"; report: BuilderReport };

type State = { kind: "idle" } | { kind: "running"; target: string } | Outcome;

function plural(n: number, one: string, many = `${one}s`): string {
  return `${n.toLocaleString()} ${n === 1 ? one : many}`;
}

export function BuilderReportView({ initialTarget }: { initialTarget: string }) {
  const router = useRouter();
  const { isLoaded, isSignedIn } = useAuth();
  const [input, setInput] = useState(initialTarget);
  const [target, setTarget] = useState(initialTarget);
  /** The last answer, and which (target, session) it answers. */
  const [settled, setSettled] = useState<{ key: string; outcome: Outcome } | null>(null);
  /** Bumped by "scan again". Part of the key, so the same target is fetched afresh. */
  const [run, setRun] = useState(0);
  const wasSignedIn = useRef<boolean | undefined>(undefined);

  // `isSignedIn` is part of the key on purpose: the same target is worth
  // refetching the moment the session changes, because the answer changed.
  const key = `${target}|${isSignedIn ? "in" : "out"}|${run}`;

  // Derived, not stored: "running" is just "no answer for this key yet", so
  // there is no loading flag to set in an effect and forget to clear.
  const state: State = !target
    ? { kind: "idle" }
    : !isLoaded || settled?.key !== key
      ? { kind: "running", target }
      : settled.outcome;

  // Signing up in the modal flips the session without a navigation. The layout
  // is a server component that rendered the nav locked, so it has to re-render.
  useEffect(() => {
    if (!isLoaded) return;
    if (wasSignedIn.current === false && isSignedIn) router.refresh();
    wasSignedIn.current = isSignedIn;
  }, [isLoaded, isSignedIn, router]);

  useEffect(() => {
    if (!isLoaded || !target) return;
    // A slow answer for an old key must not land over the current one.
    let stale = false;

    (async () => {
      try {
        const res = await fetch("/api/scan", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          // Signed in, the first read of a target is its saved copy; "scan
          // again" (run > 0) asks for a live one, which replaces it.
          body: JSON.stringify({ target, fresh: run > 0 }),
        });
        const data = (await res.json()) as BuilderReport & { error?: unknown };
        if (stale) return;
        if (!res.ok) {
          // Only a string is rendered: the backend's coarse IP limiter answers
          // in a JSON-RPC envelope whose `error` is an object, and an object in
          // JSX throws.
          const message = typeof data.error === "string" ? data.error : null;
          setSettled({ key, outcome: { kind: "failed", message: message ?? "Could not read that profile." } });
          return;
        }
        posthog.capture("builder_report_view", {
          login: data.login,
          archetype: data.archetype,
          signed_in: data.locked === null,
          locked_repos: data.locked?.repos ?? 0,
        });
        setSettled({ key, outcome: { kind: "done", report: data } });
      } catch {
        if (!stale) {
          setSettled({ key, outcome: { kind: "failed", message: "Could not reach the index. Try again." } });
        }
      }
    })();
    return () => {
      stale = true;
    };
  }, [key, target, isLoaded, run]);

  function open(value: string) {
    // In the URL, so a refresh, a shared link and the sign-up redirect all
    // come back to this report.
    router.replace(`/dashboard/report?target=${encodeURIComponent(value)}`, { scroll: false });
    setInput(value);
    setTarget(value);
  }

  function submit(event: React.FormEvent) {
    event.preventDefault();
    const value = input.trim().replace(/^[/@]+/, "");
    if (value) open(value);
  }

  const running = state.kind === "running";

  return (
    <>
      <form onSubmit={submit} className="flex max-w-xl gap-2">
        <label htmlFor="builder-target" className="sr-only">
          GitHub username or repository
        </label>
        <Input
          id="builder-target"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="your-name, or your-name/your-repo"
          spellCheck={false}
          autoComplete="off"
          autoCapitalize="off"
        />
        <button
          type="submit"
          disabled={running || !input.trim()}
          className={buttonVariants({ variant: "outline" })}
        >
          {running ? "Reading…" : "Scan"}
        </button>
      </form>

      {isSignedIn && (
        <SavedScans
          current={target}
          version={state.kind === "done" ? state.report.savedAt : undefined}
          onOpen={open}
        />
      )}

      {state.kind === "idle" && (
        <EmptyState title="Scan a GitHub profile">
          Type a username, or a repo to put that repo first. Public repos only.
        </EmptyState>
      )}
      {state.kind === "running" && <Scanning target={state.target} />}
      {state.kind === "failed" && <InlineError>{state.message}</InlineError>}
      {state.kind === "done" && (
        <Report report={state.report} target={target} onRescan={() => setRun((n) => n + 1)} />
      )}
    </>
  );
}

/**
 * The account's saved reports, most recent first. Each opens from its saved
 * copy with no scan; "scan again" on the report is what refreshes one.
 *
 * `version` is the open report's save time, so a scan that just saved shows up
 * here without a reload.
 */
function SavedScans({
  current,
  version,
  onOpen,
}: {
  current: string;
  version: string | null | undefined;
  onOpen: (target: string) => void;
}) {
  const [scans, setScans] = useState<SavedBuilderScan[]>([]);

  useEffect(() => {
    let stale = false;
    fetch("/api/scan/saved")
      .then((res) => (res.ok ? (res.json() as Promise<{ scans?: SavedBuilderScan[] }>) : { scans: [] }))
      .then((data) => !stale && setScans(data.scans ?? []))
      // The list is a shortcut; without it the scan box still works.
      .catch(() => {});
    return () => {
      stale = true;
    };
  }, [version]);

  if (scans.length === 0) return null;
  const active = current.trim().replace(/^[/@]+/, "").toLowerCase();

  return (
    <nav aria-label="Saved scans" className="mt-4">
      <p className={microLabel}>saved scans</p>
      <ul className="mt-2 flex gap-2 overflow-x-auto pb-1">
        {scans.map((s) => (
          <li key={s.target} className="shrink-0">
            <button
              type="button"
              onClick={() => onOpen(s.target)}
              aria-current={s.target === active ? "true" : undefined}
              className={cn(
                "flex w-[220px] items-center gap-3 rounded-[var(--radius-panel)] border border-edge px-3 py-2.5 text-left transition-colors hover:bg-surface-2/70",
                s.target === active && "bg-surface-2",
              )}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={s.avatarUrl} alt="" className="size-9 shrink-0 rounded-[6px] border border-edge bg-surface-2" />
              <span className="min-w-0">
                <span className="block truncate font-mono text-[12.5px] text-ink">{s.target}</span>
                <span className="block truncate text-[11.5px] text-ink-3">
                  {ARCHETYPES[s.archetype].name} · {relativeTime(s.scannedAt)}
                </span>
              </span>
            </button>
          </li>
        ))}
      </ul>
    </nav>
  );
}

function Scanning({ target }: { target: string }) {
  return (
    <Panel>
      <p aria-live="polite" className="text-[13px] text-ink-2">
        Reading <span className="font-mono text-ink">{target}</span>&rsquo;s repositories, then
        their stacks against the index.
      </p>
      <div aria-hidden className="mt-4 space-y-2.5">
        {[70, 52, 84].map((w, i) => (
          <div
            key={w}
            className="h-3 animate-pulse rounded bg-muted/50"
            style={{ width: `${w}%`, animationDelay: `${i * 90}ms` }}
          />
        ))}
      </div>
    </Panel>
  );
}

function Report({
  report,
  target,
  onRescan,
}: {
  report: BuilderReport;
  target: string;
  onRescan: () => void;
}) {
  const type = ARCHETYPES[report.archetype];
  const [first, ...rest] = report.repos;
  // What they typed, not the login: a typed repo is the one they came to see,
  // and it has to be first again when sign-up brings them back.
  const back = `/dashboard/report?target=${encodeURIComponent(target)}`;
  const languages = report.stats.languages;

  return (
    <>
      <Panel>
        <div className="flex flex-wrap items-center gap-5">
          {/* GitHub serves the avatar at the requested size; next/image would
              need remotePatterns config for no gain. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={report.avatarUrl}
            alt=""
            className="size-16 shrink-0 rounded-[var(--radius-panel)] border border-edge bg-surface-2"
          />
          <div className="min-w-0 flex-1">
            <p className={microLabel}>builder type</p>
            <h2 className="mt-1.5 text-[1.9rem] font-medium leading-none tracking-[-0.03em] text-ink">
              {type.name}
            </h2>
            <p className="mt-2 max-w-[62ch] text-[13.5px] leading-relaxed text-ink-2">{archetypeLine(report)}</p>
          </div>
          <div className="flex flex-col items-end gap-1.5">
            <a
              href={report.url}
              target="_blank"
              rel="noopener"
              className="font-mono text-[12.5px] text-ink-3 transition-colors hover:text-ink"
            >
              @{report.login}
            </a>
            {report.savedAt && (
              <button
                type="button"
                onClick={onRescan}
                title="Scan again"
                className="inline-flex items-center gap-1.5 font-mono text-[11.5px] text-ink-3 transition-colors hover:text-ink"
              >
                <RefreshCw aria-hidden className="size-3" />
                saved {relativeTime(report.savedAt)}
              </button>
            )}
            {report.savedAt && savedDaysAgo(report.savedAt) >= 1 && (
              <span className="max-w-[26ch] text-right text-[11px] leading-snug text-warn">
                Numbers from {plural(savedDaysAgo(report.savedAt), "day")} ago. Scan again for current versions and
                advisories.
              </span>
            )}
          </div>
        </div>
        <ReportActions report={report} target={target} back={back} />
      </Panel>

      <StatRow>
        <StatTile
          label="repos"
          value={report.stats.repos}
          hint={
            report.coverage?.reposCapped
              ? `owned, from the ${report.coverage.reposListed} most recently pushed`
              : "owned, not forks"
          }
        />
        <StatTile label="active" value={report.stats.active90} hint="pushed in the last 90 days" />
        <StatTile label="stars" value={report.stats.stars} />
        <StatTile
          label="top language"
          value={languages[0]?.name ?? "—"}
          hint={languages.length > 1 ? `then ${languages.slice(1, 3).map((l) => l.name).join(", ")}` : undefined}
        />
      </StatRow>

      {report.coverage && report.coverage.unreadManifests.length > 0 && (
        <InlineError>
          GitHub didn&rsquo;t answer for {plural(report.coverage.unreadManifests.length, "repo")} (
          {report.coverage.unreadManifests.join(", ")}), so their package.json was not read and they are left out
          of everything below. This report was not saved. Scan again in a minute.
        </InlineError>
      )}

      {report.standing && <Standing standing={report.standing} />}

      <Summary report={report} />

      <Traits traits={report.traits} archetype={report.archetype} back={back} />
      {/* Signed-in only, like every other piece of evidence here: the gate
          sells the facts behind the scores, and this is one of them. */}
      {report.traits && <UpkeepAxes stack={report.repos[0]} />}

      {report.locked && <Gate report={report} back={back} />}

      {first ? (
        <Panel padding="none">
          <StackHead stack={first} hiddenDeps={report.locked?.deps ?? 0} locked={report.locked !== null} />
          <StackBody stack={first} report={report} />
          {report.locked && (report.locked.deps > 0 || report.locked.conflicts > 0) && (
            <LockedRow>
              {[
                report.locked.deps > 0 &&
                  plural(report.locked.deps, "more dependency", "more dependencies"),
                report.locked.conflicts > 0 && plural(report.locked.conflicts, "conflict"),
              ]
                .filter(Boolean)
                .join(" and ")}{" "}
              in this repo, with a free account.
            </LockedRow>
          )}
        </Panel>
      ) : (
        <EmptyState title="No JavaScript stack to read">
          None of @{report.login}&rsquo;s top public repos has a root package.json, so stack health
          is unscored. The other three traits come from the repo list alone.
        </EmptyState>
      )}

      {!report.locked && rest.length > 0 && (
        <Panel padding="none">
          <div className="flex h-11 items-center border-b border-edge px-[var(--panel-px)]">
            <p className="text-[13px] font-medium tracking-[-0.01em] text-ink">
              {plural(rest.length, "more repo")} read
            </p>
          </div>
          <ul className="divide-y divide-edge">
            {rest.map((stack) => (
              <li key={stack.repo}>
                <details className="group">
                  <summary className="flex cursor-pointer list-none items-center gap-2.5 px-[var(--panel-px)] py-2.5 transition-colors hover:bg-surface-2/70 [&::-webkit-details-marker]:hidden">
                    <ChevronRight
                      aria-hidden
                      className="size-3.5 shrink-0 text-ink-3 transition-transform group-open:rotate-90 motion-reduce:transition-none"
                    />
                    <span className="truncate font-mono text-[12.5px] text-ink">{stack.repo}</span>
                    <span className="ml-auto">
                      <Counts stack={stack} />
                    </span>
                  </summary>
                  <div className="border-t border-edge">
                    <div className="flex justify-end border-b border-edge px-[var(--panel-px)] py-2">
                      <RepoCopy stack={stack} />
                    </div>
                    <StackBody stack={stack} report={report} bare />
                  </div>
                </details>
              </li>
            ))}
          </ul>
        </Panel>
      )}

      <McpSection report={report} />

      <SharedPackages report={report} />

      <KeepItFixed report={report} first={first} onRescan={onRescan} />
    </>
  );
}

/**
 * The four traits. Signed out, the names are shown and the scores are not: the
 * list of what was measured is part of the ask, and a blurred bar would have to
 * be either the real score (then it is not locked) or an invented one.
 */
function Traits({
  traits,
  archetype,
  back,
}: {
  traits: Trait[] | null;
  archetype: BuilderReport["archetype"];
  back: string;
}) {
  const rows: Trait[] =
    traits ??
    (Object.keys(ARCHETYPES) as Trait["id"][]).map((id) => ({ id, score: null, evidence: [] }));

  return (
    <Panel>
      <PanelHeader
        title="trait scores"
        trailing={
          traits ? null : (
            <SignUpButton mode="modal" fallbackRedirectUrl={back} signInFallbackRedirectUrl={back}>
              <button
                type="button"
                className="inline-flex items-center gap-1.5 text-[12px] text-signal hover:underline"
              >
                <Lock aria-hidden className="size-3" />
                Unlock
              </button>
            </SignUpButton>
          )
        }
      />
      <ul className="space-y-3.5">
        {rows.map((t) => (
          <li key={t.id}>
            <div className="flex items-center gap-3">
              <span className="w-28 shrink-0 text-[13px] text-ink">{ARCHETYPES[t.id].trait}</span>
              <div className="relative h-1.5 flex-1 overflow-hidden rounded-full bg-muted/40">
                {traits && t.score !== null && (
                  <div
                    className={cn(
                      "absolute inset-y-0 left-0 rounded-full",
                      t.id === archetype ? "bg-signal" : "bg-ink-3",
                    )}
                    style={{ width: `${t.score}%` }}
                  />
                )}
              </div>
              <span className="w-10 shrink-0 text-right font-mono text-[12px] tabular-nums text-ink-2">
                {traits ? (t.score ?? "n/a") : <Lock aria-label="locked" className="ml-auto size-3 text-ink-3" />}
              </span>
              {t.id === archetype && <Chip tone="accent">top trait</Chip>}
            </div>
            {t.evidence.length > 0 && (
              <p className="mt-1 pl-[7.75rem] text-[11.5px] leading-snug text-ink-3">
                {t.evidence.join(" · ")}
              </p>
            )}
          </li>
        ))}
      </ul>
    </Panel>
  );
}

/**
 * Upkeep on the leading repo: what drifts that is not a dependency version.
 *
 * Deliberately a second panel rather than more trait rows. The traits answer
 * "who are you as a builder" and are scored across every repo; these answer
 * "is this project being kept" and are read from one repo's files, so merging
 * them would put two different claims on one scale.
 *
 * A null score renders "n/a" with its reason in the evidence line, never a zero
 * bar — `src/github/upkeepAxes.ts` goes to some trouble to keep "we could not
 * look" distinct from "nothing is there", and collapsing it here would throw
 * that away at the last hop.
 */
function UpkeepAxes({ stack }: { stack: RepoStack | undefined }) {
  const axes = stack?.upkeep ?? [];
  if (!stack || axes.length === 0) return null;
  return (
    <Panel>
      <PanelHeader
        title="upkeep"
        trailing={<span className="font-mono text-[11.5px] text-ink-3">{stack.repo}</span>}
      />
      <ul className="space-y-3.5">
        {axes.map((axis) => (
          <li key={axis.id}>
            <div className="flex items-center gap-3">
              <span className="w-28 shrink-0 text-[13px] text-ink">{UPKEEP_AXES[axis.id]}</span>
              <div className="relative h-1.5 flex-1 overflow-hidden rounded-full bg-muted/40">
                {axis.score !== null && (
                  <div
                    className="absolute inset-y-0 left-0 rounded-full bg-ink-3"
                    style={{ width: `${axis.score}%` }}
                  />
                )}
              </div>
              <span className="w-10 shrink-0 text-right font-mono text-[12px] tabular-nums text-ink-2">
                {axis.score ?? "n/a"}
              </span>
            </div>
            {axis.evidence.length > 0 && (
              <p className="mt-1 pl-[7.75rem] text-[11.5px] leading-snug text-ink-3">
                {axis.evidence.join(" · ")}
              </p>
            )}
          </li>
        ))}
      </ul>
    </Panel>
  );
}

/** The sign-up ask, stated in the visitor's own numbers. */
function Gate({ report, back }: { report: BuilderReport; back: string }) {
  const locked = report.locked!;
  const first = report.repos[0];
  const items = [
    "The score on all four traits, and the facts behind each",
    "Strengths, what to fix, and a stats card to share",
    "What changed in each outdated dependency, and the advisories behind every flag",
    locked.repos > 0 && `${plural(locked.repos, "more repo")} on this profile, read against the index`,
    locked.deps > 0 &&
      first &&
      `${plural(locked.deps, "more dependency", "more dependencies")} in ${first.repo}`,
    locked.conflicts > 0 && `${plural(locked.conflicts, "upgrade conflict")} written out`,
    "The rest of the dashboard: autopilot, policy, API keys",
  ].filter(Boolean) as string[];

  return (
    <Panel className="relative overflow-hidden">
      <span aria-hidden className="absolute inset-y-0 left-0 w-[2px] bg-signal" />
      <p className="text-[15px] font-medium tracking-[-0.01em] text-ink">
        The full report is already computed.
      </p>
      <ul className="mt-2.5 space-y-1">
        {items.map((item) => (
          <li key={item} className="flex gap-2 text-[13px] leading-relaxed text-ink-2">
            <Lock aria-hidden className="mt-1 size-3 shrink-0 text-ink-3" />
            {item}
          </li>
        ))}
      </ul>
      <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2">
        {/* A modal, not a trip to /sign-up: the report stays on screen behind
            it, and closing the modal costs them nothing they had. */}
        <SignUpButton mode="modal" fallbackRedirectUrl={back} signInFallbackRedirectUrl={back}>
          <button type="button" className={buttonVariants()}>
            Unlock the full report
          </button>
        </SignUpButton>
        <SignInButton mode="modal" fallbackRedirectUrl={back} signUpFallbackRedirectUrl={back}>
          <button
            type="button"
            className="text-[12.5px] text-ink-3 underline-offset-4 hover:text-ink hover:underline"
          >
            I already have an account
          </button>
        </SignInButton>
      </div>
      <p className="mt-2.5 text-[11.5px] text-ink-3">Free. Nothing to install.</p>
    </Panel>
  );
}

/**
 * The report's two exports: everything as a brief for a coding agent, and the
 * stats card. Both are signed-in only: the card is the trait scores, and the
 * fix prompts are what a free account is for. A signed-out visitor still sees
 * every finding they were sent; the prompt that fixes them is the ask.
 * The card opens in a viewer first, and is downloaded from there.
 */
function ReportActions({ report, target, back }: { report: BuilderReport; target: string; back: string }) {
  return (
    <div className="mt-5 flex flex-wrap items-center gap-2 border-t border-edge pt-4">
      {report.locked ? (
        <LockedCopy label="Copy fix prompt for your AI" />
      ) : (
        <CopyButton
          sticky
          text={reportBrief(report)}
          label="Copy fix prompt for your AI"
          onCopy={() => posthog.capture("builder_report_copy", { scope: "report", login: report.login })}
        />
      )}
      {report.locked ? (
        <SignUpButton mode="modal" fallbackRedirectUrl={back} signInFallbackRedirectUrl={back}>
          <button type="button" className={cn(buttonVariants({ variant: "outline", size: "sm" }), "gap-1.5")}>
            <Lock aria-hidden className="size-3.5" />
            View stats card
          </button>
        </SignUpButton>
      ) : (
        <CardViewer report={report} target={target} />
      )}
      <p className="text-[11.5px] text-ink-3">
        Paste it into Claude, ChatGPT or Cursor: repos worst first, the steps to fix each, and how to check the fix with lurq.
      </p>
    </div>
  );
}

/**
 * The stats card, seen before it is saved.
 *
 * The image IS the export (same route, minus the attachment header), so the
 * preview is exactly the file they download; a React copy of the card would be
 * a second design to keep in step with the first. The save time is in the URL,
 * so reopening is cached and a rescan is a new image.
 */
function CardViewer({ report, target }: { report: BuilderReport; target: string }) {
  const qs = new URLSearchParams({ target });
  if (report.savedAt) qs.set("v", report.savedAt);
  const src = `/api/scan/card?${qs.toString()}`;
  /** Which image finished, and how. Keyed by src so a new report starts loading again. */
  const [settled, setSettled] = useState<{ src: string; ok: boolean } | null>(null);
  const done = settled?.src === src;

  return (
    <Dialog
      onOpenChange={(open) => {
        if (open) posthog.capture("builder_card_view", { login: report.login, archetype: report.archetype });
      }}
    >
      <DialogTrigger
        render={<button type="button" className={cn(buttonVariants({ variant: "outline", size: "sm" }), "gap-1.5")} />}
      >
        <Eye aria-hidden className="size-3.5" />
        View stats card
      </DialogTrigger>
      <DialogContent className="w-auto gap-3 p-3 sm:max-w-none">
        <DialogTitle className="sr-only">Builder card for @{report.login}</DialogTitle>
        {/* Height-led, so the 4:5 card fits a laptop screen and a phone alike. */}
        <div className="relative aspect-[4/5] h-[min(78vh,calc((100vw_-_3.5rem)*1.25))] overflow-hidden rounded-lg bg-[#09090b]">
          {!done && <div aria-hidden className="absolute inset-0 animate-pulse bg-surface-2/40 motion-reduce:animate-none" />}
          {done && !settled.ok && (
            <p className="absolute inset-0 grid place-items-center px-6 text-center text-[13px] text-ink-2">
              Could not render the card. Close and try again.
            </p>
          )}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={src}
            alt={`Builder stats card for @${report.login}`}
            onLoad={() => setSettled({ src, ok: true })}
            onError={() => setSettled({ src, ok: false })}
            className={cn(
              "size-full object-contain transition-opacity duration-300 motion-reduce:transition-none",
              done && settled.ok ? "opacity-100" : "opacity-0",
            )}
          />
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3 px-1">
          <p className="text-[11.5px] text-ink-3">1080 × 1350 PNG, the crop X, LinkedIn and Instagram show uncut.</p>
          <a
            href={`${src}&download=1`}
            download={`lurq-${report.login}.png`}
            aria-disabled={!(done && settled.ok)}
            onClick={() => posthog.capture("builder_card_export", { login: report.login, archetype: report.archetype })}
            className={cn(buttonVariants({ size: "sm" }), "gap-1.5", !(done && settled.ok) && "pointer-events-none opacity-60")}
          >
            <Download aria-hidden className="size-3.5" />
            Download PNG
          </a>
        </div>
      </DialogContent>
    </Dialog>
  );
}

const percent = (v: number) => `${Math.round(v * 100)}%`;

/** How each ranked metric reads. Direction is already in the percentile; the label says which way is good. */
const STANDING: Record<StandingMetricId, { label: string; show: (v: number) => string }> = {
  repos: { label: "repos", show: compact },
  active90: { label: "active in 90 days", show: String },
  stars: { label: "stars", show: compact },
  behindShare: { label: "deps behind latest", show: percent },
  majorShare: { label: "deps a major behind", show: percent },
  advisoryRate: { label: "advisories per 100 deps", show: (v) => v.toFixed(1) },
};

/**
 * Percentile ranks against the other builders lurq has a saved scan of.
 *
 * The API only ranks a metric with enough builders behind it, so an empty list
 * means "not enough scans yet" and the whole panel is omitted, rather than
 * showing a percentile of a handful of people or the size of the pool.
 */
function Standing({ standing }: { standing: BuilderStanding }) {
  if (standing.metrics.length === 0) return null;
  return (
    <Panel>
      <PanelHeader title="how you compare" />
      <ul className="space-y-3">
        {standing.metrics.map((m) => {
          const row = STANDING[m.id];
          return (
            <li key={m.id} className="flex flex-wrap items-center gap-x-3 gap-y-1" title="Ties count half.">
              <span className="w-full text-[13px] text-ink sm:w-48 sm:shrink-0">
                {row.label}
                {m.better === "lower" && <span className="ml-1.5 text-[11px] text-ink-3">lower is better</span>}
              </span>
              <span className="w-14 shrink-0 font-mono text-[12px] tabular-nums text-ink-2 sm:text-right">
                {row.show(m.value)}
              </span>
              <div className="relative h-1.5 min-w-20 flex-1 overflow-hidden rounded-full bg-muted/40">
                <div className="absolute inset-y-0 left-0 rounded-full bg-ink-3" style={{ width: `${m.percentile}%` }} />
              </div>
              <span className="w-28 shrink-0 text-right text-[12px] text-ink-2">
                ahead of <span className="font-mono tabular-nums text-ink">{m.percentile}%</span>
              </span>
            </li>
          );
        })}
      </ul>
    </Panel>
  );
}

/** What they do well and what to fix, in words. Absent while traits are locked. */
function Summary({ report }: { report: BuilderReport }) {
  const summary = summarize(report);
  if (!summary) return null;
  return (
    <Panel>
      <PanelHeader title="the short version" />
      <div className="grid gap-6 min-[720px]:grid-cols-2">
        <SummaryList title="what you do well" points={summary.strengths} dot="bg-ok" />
        <SummaryList
          title="what to fix"
          points={summary.gaps}
          dot="bg-bad"
          empty="Nothing stood out as weak in what was read."
        />
      </div>
    </Panel>
  );
}

function SummaryList({
  title,
  points,
  dot,
  empty,
}: {
  title: string;
  points: SummaryPoint[];
  dot: string;
  empty?: string;
}) {
  return (
    <div>
      <p className={microLabel}>{title}</p>
      {points.length === 0 ? (
        <p className="mt-2 text-[13px] text-ink-3">{empty}</p>
      ) : (
        <ul className="mt-2 space-y-2.5">
          {points.map((p) => (
            <li key={p.title} className="flex gap-2.5">
              <span aria-hidden className={cn("mt-[7px] size-1.5 shrink-0 rounded-full", dot)} />
              <div>
                <p className="text-[13.5px] text-ink">{p.title}</p>
                <p className="text-[12px] leading-snug text-ink-3">{p.detail}</p>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/**
 * A fix prompt, locked for a signed-out visitor. Sign-up opens in place and
 * returns to this same report (the target is in the URL), where the prompt is
 * then one click away.
 *
 * This is a conversion gate, not a secret: everything the prompt is built from
 * is already on the page they were sent.
 */
function LockedCopy({ label, inline = false }: { label: string; inline?: boolean }) {
  const params = useSearchParams();
  const back = `/dashboard/report${params.size > 0 ? `?${params.toString()}` : ""}`;
  return (
    <SignUpButton mode="modal" fallbackRedirectUrl={back} signInFallbackRedirectUrl={back}>
      <button
        type="button"
        title="Free account"
        className={
          inline
            ? "inline-flex shrink-0 items-center gap-1.5 text-[12px] text-ink-3 transition-colors hover:text-ink"
            : cn(buttonVariants({ variant: "outline", size: "sm" }), "gap-1.5")
        }
      >
        <Lock aria-hidden className={inline ? "size-3" : "size-3.5"} />
        {label}
      </button>
    </SignUpButton>
  );
}

function RepoCopy({ stack, hiddenDeps = 0, locked = false }: { stack: RepoStack; hiddenDeps?: number; locked?: boolean }) {
  if (locked) return <LockedCopy label="copy for agent" inline />;
  return (
    <CopyInline
      sticky
      text={repoBrief(stack, hiddenDeps)}
      label="copy for agent"
      onCopy={() => posthog.capture("builder_report_copy", { scope: "repo", repo: stack.repo })}
    />
  );
}

function StackHead({ stack, hiddenDeps, locked }: { stack: RepoStack; hiddenDeps: number; locked: boolean }) {
  const untracked = stack.depsDeclared - stack.depsTracked;
  return (
    <div className="flex h-11 items-center gap-3 border-b border-edge px-[var(--panel-px)]">
      <a
        href={stack.url}
        target="_blank"
        rel="noopener"
        className="truncate font-mono text-[13px] text-ink transition-colors hover:text-signal"
      >
        {stack.repo}
      </a>
      {/* Said every time: the root manifest is not the whole repo. */}
      <span className="ml-auto hidden shrink-0 font-mono text-[11px] text-ink-3 min-[560px]:inline">
        root package.json{untracked > 0 ? ` · ${untracked} not indexed yet` : ""}
      </span>
      <RepoCopy stack={stack} hiddenDeps={hiddenDeps} locked={locked} />
    </div>
  );
}

function Counts({ stack }: { stack: RepoStack }) {
  return (
    <span className="flex flex-wrap justify-end gap-1.5">
      <Chip>{plural(stack.depsTracked, "dep")}</Chip>
      {stack.majorDrift > 0 && <Chip tone="warn">{stack.majorDrift} major behind</Chip>}
      {stack.advisories > 0 && <Chip tone="bad">{plural(stack.advisories, "advisory", "advisories")}</Chip>}
      {/* At latest versions, which is what the count measures: not a claim the repo is broken today. */}
      {stack.conflicts > 0 && <Chip tone="bad">{plural(stack.conflicts, "conflict")} at latest</Chip>}
    </span>
  );
}

function StackBody({
  stack,
  report,
  bare = false,
}: {
  stack: RepoStack;
  report: BuilderReport;
  bare?: boolean;
}) {
  if (stack.depsTracked === 0) {
    return (
      <p className="px-[var(--panel-px)] py-4 text-[13px] leading-relaxed text-ink-2">
        {stack.depsDeclared === 0
          ? "This package.json declares no registry dependencies (workspace or local packages only, or none), so there is nothing here to check."
          : "Nothing in this manifest is in the index yet. It has been queued, so the same scan in a few minutes will have something to say."}
      </p>
    );
  }
  return (
    <>
      {!bare && (
        <div className="border-b border-edge px-[var(--panel-px)] py-2.5">
          <Counts stack={stack} />
        </div>
      )}
      <ul className="divide-y divide-edge">
        {stack.deps.map((dep) => (
          <DepRow key={dep.name} dep={dep} report={report} />
        ))}
      </ul>
      {stack.conflictDetail.length > 0 && (
        <Conflicts conflicts={stack.conflictDetail} repo={stack.repo} report={report} />
      )}
    </>
  );
}

/** The worst thing true about one dependency, in the fewest words. */
/** The row label and its tone. The words come from depLabel, so the page and the briefs never disagree. */
function verdict(dep: ScanDep): { text: string; tone: string } {
  const text = depLabel(dep);
  if (dep.advisories > 0 || dep.deprecated) return { text, tone: "text-bad" };
  const status = depStatus(dep);
  if (status === "major") return { text, tone: "text-warn" };
  if (status === "behind") return { text, tone: "text-ink-2" };
  return { text, tone: "text-ink-3" };
}

const ROW_OPEN =
  "flex cursor-pointer list-none flex-wrap items-baseline gap-x-3 gap-y-0.5 px-[var(--panel-px)] py-2 transition-colors hover:bg-surface-2/70 [&::-webkit-details-marker]:hidden";
const CHEVRON =
  "size-3.5 shrink-0 self-center text-ink-3 transition-transform group-open:rotate-90 motion-reduce:transition-none";
const DRAWER = "space-y-4 border-t border-edge bg-surface-2/40 px-[var(--panel-px)] py-4";

/**
 * One dependency. A flagged row opens: where else the package is declared, the
 * conflicts that name it, and (signed in) what actually changed between the
 * resolved version and the latest, or the advisories behind the flag. A current
 * row has nothing more to say, so it does not pretend to open.
 */
function DepRow({ dep, report }: { dep: ScanDep; report: BuilderReport }) {
  const v = verdict(dep);
  const [open, setOpen] = useState(false);
  const line = (
    <>
      <span className="min-w-0 max-w-full truncate font-mono text-[12.5px] text-ink">{dep.name}</span>
      {/* Wraps rather than overflowing: a canary range plus "→ latest" plus the
          verdict is wider than a phone. */}
      <span className="min-w-0 break-all font-mono text-[11.5px] text-ink-3">
        {dep.resolved ?? dep.range}
        {dep.latest && dep.latest !== dep.resolved ? ` → ${dep.latest}` : ""}
      </span>
      <span className={cn("ml-auto shrink-0 font-mono text-[11px]", v.tone)}>{v.text}</span>
    </>
  );

  if (v.text === "current") {
    return (
      <li className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 px-[var(--panel-px)] py-2">
        <span aria-hidden className="w-3.5 shrink-0" />
        {line}
      </li>
    );
  }

  return (
    <li>
      <details
        className="group"
        onToggle={(e) => {
          const isOpen = e.currentTarget.open;
          setOpen(isOpen);
          if (isOpen) posthog.capture("builder_dep_open", { package: dep.name, issue: v.text });
        }}
      >
        <summary className={ROW_OPEN}>
          <ChevronRight aria-hidden className={CHEVRON} />
          {line}
        </summary>
        {open && <DepDrawer dep={dep} report={report} />}
      </details>
    </li>
  );
}

type Lookup = { kind: "failed"; message: string } | { kind: "done"; detail: DepDetail };

function DepDrawer({ dep, report }: { dep: ScanDep; report: BuilderReport }) {
  const signedIn = report.locked === null;
  const impact = packageImpact(report, dep.name);
  const from = dep.resolved;
  const to = dep.latest;
  const wantDiff = dep.majorsBehind > 0 && Boolean(from && to);
  const wantEvaluate = dep.advisories > 0 || dep.deprecated;
  const [attempt, setAttempt] = useState(0);
  /** The last answer and the attempt it answers; "loading" is derived, like the report's own. */
  const [settled, setSettled] = useState<{ attempt: number; lookup: Lookup } | null>(null);
  const lookup = settled?.attempt === attempt ? settled.lookup : null;

  useEffect(() => {
    if (!signedIn || (!wantDiff && !wantEvaluate)) return;
    let stale = false;
    (async () => {
      let next: Lookup;
      try {
        const res = await fetch("/api/scan/dep", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            package: dep.name,
            ...(wantDiff ? { from, to } : {}),
            evaluate: wantEvaluate,
          }),
        });
        const data = (await res.json()) as DepDetail & { error?: unknown };
        next = res.ok
          ? { kind: "done", detail: data }
          : { kind: "failed", message: typeof data.error === "string" ? data.error : "Could not open that dependency." };
      } catch {
        next = { kind: "failed", message: "Could not reach lurq. Try again." };
      }
      if (!stale) setSettled({ attempt, lookup: next });
    })();
    return () => {
      stale = true;
    };
  }, [attempt, signedIn, wantDiff, wantEvaluate, dep.name, from, to]);

  const detail = lookup?.kind === "done" ? lookup.detail : null;
  const asks = wantDiff ? `what changed from ${from} to ${to}` : "the advisories behind this flag";

  return (
    <div className={DRAWER}>
      <Impact name={dep.name} impact={impact} />

      {(wantDiff || wantEvaluate) &&
        (!signedIn ? (
          <p className="text-[12.5px] leading-relaxed text-ink-2">
            <SignUpButton mode="modal">
              <button type="button" className="text-signal hover:underline">
                Sign up free
              </button>
            </SignUpButton>{" "}
            to see {asks}: every export removed, renamed or re-shaped, read from the package itself.
          </p>
        ) : !lookup ? (
          <p aria-live="polite" className="text-[12.5px] text-ink-3">
            Asking lurq for {asks}…
          </p>
        ) : lookup.kind === "failed" ? (
          <InlineError>{lookup.message}</InlineError>
        ) : (
          <>
            <Advisories detail={lookup.detail} name={dep.name} />
            {lookup.detail.diff && (
              <Changes diff={lookup.detail.diff} onRetry={() => setAttempt((n) => n + 1)} />
            )}
            {lookup.detail.unavailable.map((u) => (
              <p key={u} className="text-[12px] leading-snug text-ink-3">
                {u}
              </p>
            ))}
          </>
        ))}

      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        {signedIn ? (
          <CopyButton
            sticky
            text={depBrief(report, dep.name, detail)}
            label="Copy fix prompt"
            onCopy={() => posthog.capture("builder_report_copy", { scope: "dep", package: dep.name })}
          />
        ) : (
          <LockedCopy label="Copy fix prompt" />
        )}
        <span className="text-[11.5px] text-ink-3">
          {detail?.diff && !detail.diff.inconclusive
            ? "Includes what changed, so your agent can search your code for each name."
            : "Every repo that declares it, and how to check the upgrade with lurq."}
        </span>
      </div>
    </div>
  );
}

/** Where the package sits across the repos read, and the conflicts that name it. */
function Impact({ name, impact }: { name: string; impact: PackageImpact }) {
  return (
    <div>
      <p className={microLabel}>
        {impact.uses.length > 1 ? `declared in ${impact.uses.length} of these repos` : "declared in"}
      </p>
      <ul className="mt-1.5 space-y-1">
        {impact.uses.map(({ repo, dep }) => {
          const v = verdict(dep);
          return (
            <li key={repo} className="flex flex-wrap items-baseline gap-x-3 font-mono text-[12px]">
              <span className="text-ink-2">{repo}</span>
              <span className="break-all text-ink-3">
                {dep.range}
                {/* Inferred from the declared range: no lockfile is read. */}
                {dep.resolved
                  ? dep.resolvedFrom === "range-floor"
                    ? ` · range minimum ${dep.resolved}`
                    : ` · range resolves ${dep.resolved}`
                  : ""}
              </span>
              <span className={cn("ml-auto text-[11px]", v.tone)}>{v.text}</span>
            </li>
          );
        })}
      </ul>
      {impact.conflicts.length > 0 && (
        <>
          <p className={cn(microLabel, "mt-3")}>conflicts that name {name}</p>
          <ul className="mt-1.5 space-y-1.5">
            {impact.conflicts.map(({ repo, conflict }, i) => (
              <li key={`${repo}-${i}`} className="text-[12.5px] leading-snug text-ink-2">
                <span className="font-mono text-[12px] text-ink">{conflict.packages.join(" · ")}</span> in{" "}
                {repo}: {conflict.detail}
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

function Advisories({ detail, name }: { detail: DepDetail; name: string }) {
  const list = detail.advisories ?? [];
  if (list.length === 0 && !detail.deprecated) return null;
  return (
    <div className="space-y-3">
      {detail.deprecated && (
        <p className="flex flex-wrap items-baseline gap-2 text-[12.5px] leading-snug text-ink-2">
          <Chip tone="warn">deprecated</Chip>
          {typeof detail.deprecated === "string"
            ? detail.deprecated
            : `The maintainers have marked ${name} deprecated.`}
        </p>
      )}
      {list.length > 0 && (
        <div>
          <p className={microLabel}>advisories on record for {name} · most severe first</p>
          <ul className="mt-1.5 space-y-1.5">
            {list.map((a) => (
              <li key={a.id} className="flex flex-wrap items-baseline gap-x-2 gap-y-1 text-[12.5px] leading-snug">
                <Chip tone={a.severity === "critical" || a.severity === "high" ? "bad" : "warn"}>{a.severity}</Chip>
                <span className="text-ink-2">{a.summary}</span>
                {a.id.startsWith("GHSA-") ? (
                  <a
                    href={`https://github.com/advisories/${a.id}`}
                    target="_blank"
                    rel="noopener"
                    className="font-mono text-[11px] text-ink-3 underline-offset-4 hover:text-ink hover:underline"
                  >
                    {a.id}
                  </a>
                ) : (
                  <span className="font-mono text-[11px] text-ink-3">{a.id}</span>
                )}
              </li>
            ))}
          </ul>
          <p className="mt-2 text-[11.5px] text-ink-3">
            An advisory names the versions it affects. Check that range against the version you resolve.
          </p>
        </div>
      )}
    </div>
  );
}

/** The package's own change list between two versions. Never "your code breaks": lurq has not read it. */
function Changes({ diff, onRetry }: { diff: DepDiff; onRetry: () => void }) {
  const head = (
    <p className={microLabel}>
      what changed · {diff.fromVersion} → {diff.toVersion}
    </p>
  );

  if (diff.inconclusive) {
    return (
      <div>
        {head}
        <p className="mt-1.5 text-[12.5px] leading-snug text-ink-2">
          lurq has not read one of these versions yet. It is queued, and usually ready within a minute. This is
          not evidence that anything was removed.
        </p>
        <button
          type="button"
          onClick={onRetry}
          className="mt-2 inline-flex items-center gap-1.5 text-[12px] text-signal hover:underline"
        >
          <RefreshCw aria-hidden className="size-3" />
          Check again
        </button>
      </div>
    );
  }

  const renamed = new Map(diff.renamed.map((r) => [r.path, r.to]));
  const breaking = diff.removed.length + diff.arityChanged.length + diff.typeOnlyRemoved.length;
  return (
    <div className="space-y-3">
      {head}
      {breaking === 0 ? (
        <p className="text-[12.5px] leading-snug text-ink-2">
          No exports were removed or re-shaped between these versions. Behaviour and configuration changes
          are not covered here, so read the changelog too.
        </p>
      ) : (
        <>
          <SymbolChips
            label="removed at runtime · breaks node"
            tone="bad"
            items={diff.removed.map((s) =>
              renamed.has(s.path) ? `${s.path} → ${renamed.get(s.path)!.join(" | ")}` : s.path,
            )}
          />
          <SymbolChips
            label="parameter count changed"
            tone="warn"
            items={diff.arityChanged.map((a) => `${a.path} (${a.from ?? "?"} → ${a.to ?? "?"})`)}
          />
          <SymbolChips label="type-only removals · breaks tsc" tone="muted" items={diff.typeOnlyRemoved} />
        </>
      )}
      <SymbolChips label="newly deprecated" tone="warn" items={diff.deprecated} />
      {breaking > 0 && (
        <p className="text-[11.5px] leading-snug text-ink-3">
          These are the package&rsquo;s changes; lurq has not read your code. Copy the fix prompt and your agent
          searches your repos for each name.
        </p>
      )}
    </div>
  );
}

function SymbolChips({ label, items, tone }: { label: string; items: string[]; tone: "bad" | "warn" | "muted" }) {
  const [all, setAll] = useState(false);
  if (items.length === 0) return null;
  const shown = all ? items : items.slice(0, 24);
  return (
    <div>
      <p className={microLabel}>
        {label} · {items.length}
      </p>
      <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
        {shown.map((s) => (
          <code
            key={s}
            className={cn(
              "break-all rounded-[var(--radius-chip)] border px-1.5 py-0.5 font-mono text-[11.5px]",
              tone === "bad" && "border-bad/30 text-ink",
              tone === "warn" && "border-warn/30 text-ink",
              tone === "muted" && "border-edge text-ink-3",
            )}
          >
            {s}
          </code>
        ))}
        {items.length > shown.length && (
          <button type="button" onClick={() => setAll(true)} className="text-[12px] text-signal hover:underline">
            +{items.length - shown.length} more
          </button>
        )}
      </div>
    </div>
  );
}

/** What each kind of conflict means, for someone who has not read the compat tool's source. */
const CONFLICT_MEANS: Record<ScanConflict["source"], string> = {
  "peer-deps":
    "These packages require different versions of a shared peer. npm refuses the install, and --legacy-peer-deps installs a combination one of them was never tested with.",
  engines: "Their Node engine ranges do not overlap, so no single Node version satisfies all of them.",
  sandbox: "Installing this set at its latest versions in a clean sandbox failed.",
  resolve:
    "npm could not resolve this set at its latest versions. It reports the set, not which two packages are at fault, so treat them together.",
};

function Conflicts({
  conflicts,
  repo,
  report,
}: {
  conflicts: ScanConflict[];
  repo: string;
  report: BuilderReport;
}) {
  const stack = report.repos.find((s) => s.repo === repo);
  return (
    <ul className="divide-y divide-edge border-t border-edge">
      {conflicts.map((c, i) => (
        <li key={`${c.source}-${i}`}>
          <details
            className="group"
            onToggle={(e) => {
              if (e.currentTarget.open) posthog.capture("builder_conflict_open", { repo, source: c.source });
            }}
          >
            <summary className="flex cursor-pointer list-none gap-2.5 px-[var(--panel-px)] py-3 transition-colors hover:bg-surface-2/70 [&::-webkit-details-marker]:hidden">
              <ChevronRight aria-hidden className={cn(CHEVRON, "mt-0.5 self-start")} />
              <span className="min-w-0 flex-1">
                <span className="block font-mono text-[12px] text-ink">{c.packages.join(" · ")}</span>
                <span className="mt-1 block text-[12.5px] leading-normal text-ink-2">{c.detail}</span>
              </span>
              <span className="shrink-0">
                <Chip tone="bad">{c.source}</Chip>
              </span>
            </summary>
            <div className={DRAWER}>
              <p className="text-[12.5px] leading-snug text-ink-2">{CONFLICT_MEANS[c.source]}</p>
              <ul className="space-y-1">
                {c.packages.map((p) => {
                  const dep = stack?.deps.find((d) => namesPackage(p, d.name));
                  const elsewhere = packageImpact(report, dep?.name ?? p).uses.filter((u) => u.repo !== repo);
                  return (
                    <li key={p} className="flex flex-wrap items-baseline gap-x-3 font-mono text-[12px]">
                      <span className="text-ink">{dep?.name ?? p}</span>
                      <span className="break-all text-ink-3">
                        {dep
                          ? `${dep.resolved ?? dep.range}${dep.latest && dep.latest !== dep.resolved ? ` → ${dep.latest}` : ""}`
                          : "not declared at the root"}
                      </span>
                      {elsewhere.length > 0 && (
                        <span className="font-sans text-[11.5px] text-ink-3">
                          also in {elsewhere.map((u) => u.repo).join(", ")}
                        </span>
                      )}
                    </li>
                  );
                })}
              </ul>
              <CopyButton
                sticky
                text={conflictBrief(report, repo, c)}
                label="Copy fix prompt"
                onCopy={() => posthog.capture("builder_report_copy", { scope: "conflict", repo })}
              />
            </div>
          </details>
        </li>
      ))}
    </ul>
  );
}

/**
 * One server in a config. A probed server opens into the tools it hands the
 * agent: what each one takes, whether it returns something parseable, and what
 * it is allowed to do. There is nothing to open for a server lurq could not
 * probe, so those stay a plain row.
 */
function McpServerRow({ server }: { server: ProfileMcpServer }) {
  const tools = server.toolDetail ?? [];
  const line = (
    <>
      <span className="font-mono text-ink">{server.alias}</span>
      <span className="break-all font-mono text-ink-3">{server.packageName ?? server.endpoint ?? ""}</span>
      <span className={cn("ml-auto text-[12px]", MCP_TONE[server.status] ?? "text-ink-3")}>
        {mcpServerLabel(server)}
      </span>
    </>
  );

  if (tools.length === 0) {
    return (
      <li className="flex flex-wrap items-baseline gap-x-3 text-[12.5px]">
        <span aria-hidden className="w-3.5 shrink-0" />
        {line}
      </li>
    );
  }

  return (
    <li>
      <details className="group">
        <summary className="flex cursor-pointer list-none flex-wrap items-baseline gap-x-3 text-[12.5px] [&::-webkit-details-marker]:hidden">
          <ChevronRight aria-hidden className={CHEVRON} />
          {line}
        </summary>
        <ul className="mt-2 space-y-1.5 border-l border-edge pl-3">
          {tools.map((t) => {
            const power = mcpToolPower(t);
            return (
              <li key={t.name} className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 text-[12px]">
                <span className="font-mono text-ink">{t.name}</span>
                <span className="text-ink-3">{mcpToolSummary(t)}</span>
                <span className={cn("ml-auto font-mono text-[11px]", power.tone)}>{power.text}</span>
                {t.required.length > 0 && (
                  <span className="w-full break-all font-mono text-[11px] text-ink-3">
                    requires {t.required.join(", ")}
                  </span>
                )}
              </li>
            );
          })}
        </ul>
        {server.tools > tools.length && (
          <p className="mt-2 pl-3 text-[11.5px] text-ink-3">
            {plural(server.tools - tools.length, "more tool")} not listed. The counts above are exact.
          </p>
        )}
      </details>
    </li>
  );
}

const MCP_TONE: Record<string, string> = {
  probed: "text-ink-2",
  "handshake-failed": "text-bad",
  queued: "text-warn",
  "needs-config": "text-warn",
};

/**
 * MCP servers in the repos read: what they commit to their agents' configs, and
 * the repos that are MCP servers. Evidence from those files and lurq's index of
 * probed servers only; anything lurq cannot probe says so. Absent when the repos
 * read have neither, so a profile with no MCP gets no empty panel.
 */
function McpSection({ report }: { report: BuilderReport }) {
  const mcp = report.mcp;
  const hidden = report.locked?.mcp ?? 0;
  if (!mcp || (mcp.configs.length === 0 && mcp.builds.length === 0 && mcp.unreadFiles === 0)) return null;

  return (
    <Panel>
      <PanelHeader
        title="mcp servers"
        trailing={<span className="text-[11.5px] text-ink-3">from committed configs and lurq&apos;s probes</span>}
      />
      {mcp.builds.length > 0 && (
        <div>
          <p className={microLabel}>built here</p>
          <ul className="mt-1.5 space-y-1">
            {mcp.builds.map((b) => (
              <li key={b.repo} className="flex flex-wrap items-baseline gap-x-3 text-[12.5px]">
                <span className="font-mono text-ink">{b.repo}</span>
                <span className="font-mono text-ink-3">{b.packageName}</span>
                <span className={cn("ml-auto text-[12px]", MCP_TONE[b.status] ?? "text-ink-3")}>
                  {mcpServerLabel(b)}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
      {mcp.configs.map((c) => (
        <div key={c.repo} className={cn(mcp.builds.length > 0 || c !== mcp.configs[0] ? "mt-5" : "")}>
          <p className={microLabel}>
            {c.repo} · {c.files.join(", ")}
          </p>
          <ul className="mt-1.5 space-y-1">
            {c.servers.map((s) => (
              <McpServerRow key={`${s.alias}-${s.packageName ?? s.endpoint ?? ""}`} server={s} />
            ))}
          </ul>
          {c.collisions.map((x) => (
            <p key={x.tool} className="mt-2 text-[12.5px] leading-snug text-bad">
              <span className="font-mono">{x.tool}</span> is exposed by {x.servers.join(" and ")}: the agent cannot say
              which one it means{x.writes ? ", and one of them can write" : ""}.
            </p>
          ))}
          <p className="mt-2 text-[11.5px] text-ink-3">
            {c.totalTools !== null
              ? `${plural(c.totalTools, "tool")} in total, about ${c.estimatedContextTokens?.toLocaleString()} tokens of schema in every request.`
              : "Total tools unknown: not every server here is probed."}
          </p>
        </div>
      ))}
      {mcp.unreadFiles > 0 && (
        <p className="mt-3 text-[12px] text-warn">
          GitHub didn&rsquo;t answer for {plural(mcp.unreadFiles, "MCP file")}, so servers in them are missing.
        </p>
      )}
      {hidden > 0 && (
        <div className="mt-3">
          <LockedRow>{plural(hidden, "more MCP config or server", "more MCP configs or servers")} with a free account.</LockedRow>
        </div>
      )}
    </Panel>
  );
}

/**
 * Packages declared in more than one repo: the same dependency drifting to
 * different versions across a profile is invisible repo by repo. Signed in only,
 * because a signed-out report carries one repo.
 */
function SharedPackages({ report }: { report: BuilderReport }) {
  const [all, setAll] = useState(false);
  const shared = report.locked ? [] : sharedPackages(report);
  if (shared.length === 0) return null;
  const shown = all ? shared : shared.slice(0, 8);

  return (
    <Panel padding="none">
      <div className="flex min-h-11 flex-wrap items-center gap-x-3 gap-y-1 border-b border-edge px-[var(--panel-px)] py-2.5">
        <p className="text-[13px] font-medium tracking-[-0.01em] text-ink">Across these repos</p>
        <span className="ml-auto font-mono text-[11px] text-ink-3">
          {plural(shared.length, "package")} in more than one
        </span>
      </div>
      <ul className="divide-y divide-edge">
        {shown.map((p) => (
          <li key={p.name}>
            <details className="group">
              <summary className={cn(ROW_OPEN, "items-center py-2.5")}>
                <ChevronRight aria-hidden className={CHEVRON} />
                <span className="min-w-0 truncate font-mono text-[12.5px] text-ink">{p.name}</span>
                <span className="ml-auto flex flex-wrap gap-1.5">
                  <Chip>{plural(p.uses.length, "repo")}</Chip>
                  {p.versions.length > 1 && <Chip tone="warn">{p.versions.length} versions</Chip>}
                  {p.flagged && <Chip tone="bad">needs work</Chip>}
                </span>
              </summary>
              <div className={DRAWER}>
                <ul className="space-y-1">
                  {p.uses.map(({ repo, dep }) => {
                    const v = verdict(dep);
                    return (
                      <li key={repo} className="flex flex-wrap items-baseline gap-x-3 font-mono text-[12px]">
                        <span className="text-ink-2">{repo}</span>
                        <span className="break-all text-ink-3">{dep.resolved ?? dep.range}</span>
                        <span className={cn("ml-auto text-[11px]", v.tone)}>{v.text}</span>
                      </li>
                    );
                  })}
                </ul>
                <CopyButton
                  sticky
                  text={depBrief(report, p.name)}
                  label="Copy fix prompt"
                  onCopy={() => posthog.capture("builder_report_copy", { scope: "shared", package: p.name })}
                />
              </div>
            </details>
          </li>
        ))}
      </ul>
      {shared.length > shown.length && (
        <button
          type="button"
          onClick={() => setAll(true)}
          className="w-full border-t border-edge px-[var(--panel-px)] py-2.5 text-left text-[12.5px] text-signal hover:underline"
        >
          Show {shared.length - shown.length} more
        </button>
      )}
    </Panel>
  );
}

/**
 * After the findings, how they stay fixed: lurq in the agent so the next pick is
 * checked, a connected repo so a breaking release is heard about, and a rescan to
 * see the fixes land. Every claim here is something the product does today.
 */
function KeepItFixed({
  report,
  first,
  onRescan,
}: {
  report: BuilderReport;
  first: RepoStack | undefined;
  onRescan: () => void;
}) {
  const connect = first ? `/dashboard/repos?scan=${encodeURIComponent(first.repo)}` : "/dashboard/repos";
  return (
    <Panel>
      <PanelHeader title="keep it this way" />
      <ol className="grid gap-6 min-[900px]:grid-cols-3">
        <Step n={1} title="Check packages as your agent picks them">
          With lurq in your coding agent, every package and upgrade is checked before it is written, so these
          findings do not come back.
          <div className="mt-3">
            <CopyButton
              text={INSTALL_COMMAND}
              label={INSTALL_COMMAND}
              className="font-mono"
              onCopy={() => posthog.capture("builder_report_install_copy", { login: report.login })}
            />
          </div>
        </Step>
        <Step n={2} title={first ? `Watch ${first.repo}` : "Watch a repo"}>
          A connected repo has every manifest read and rescanned daily, and you hear when a dependency ships a
          new major. Its autopilot can check which changes your code actually calls.
          <div className="mt-3">
            <Link
              href={connect}
              onClick={() => posthog.capture("builder_report_connect", { repo: first?.repo ?? null })}
              className={buttonVariants({ variant: "outline", size: "sm" })}
            >
              Connect {first ? first.repo : "a repo"}
            </Link>
          </div>
        </Step>
        <Step n={3} title="Scan again after you fix">
          Push the fixes to the default branch, then run this report again to see the counts drop. A repo read
          in the last 15 minutes shows its earlier result.
          <div className="mt-3">
            <button
              type="button"
              onClick={() => {
                posthog.capture("builder_report_rescan", { login: report.login });
                onRescan();
              }}
              className={cn(buttonVariants({ variant: "outline", size: "sm" }), "gap-1.5")}
            >
              <RefreshCw aria-hidden className="size-3.5" />
              Scan again
            </button>
          </div>
        </Step>
      </ol>
    </Panel>
  );
}

function Step({ n, title, children }: { n: number; title: string; children: ReactNode }) {
  return (
    <li className="text-[12.5px] leading-relaxed text-ink-2">
      <p className="flex items-baseline gap-2 text-[13.5px] font-medium text-ink">
        <span className="font-mono text-[11px] text-ink-3">{n}</span>
        {title}
      </p>
      <div className="mt-1.5">{children}</div>
    </li>
  );
}

function LockedRow({ children }: { children: ReactNode }) {
  return (
    <p className="flex items-center gap-2 border-t border-edge bg-surface-2 px-[var(--panel-px)] py-2.5 text-[12.5px] text-ink-2">
      <Lock aria-hidden className="size-3 shrink-0 text-ink-3" />
      <span>{children}</span>
    </p>
  );
}
