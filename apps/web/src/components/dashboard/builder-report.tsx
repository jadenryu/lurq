"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { SignInButton, SignUpButton, useAuth } from "@clerk/nextjs";
import { ChevronRight, Download, Lock } from "lucide-react";
import posthog from "posthog-js";
import { buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { CopyButton, CopyInline } from "@/components/dashboard/copy-button";
import { repoBrief, reportBrief, summarize, type SummaryPoint } from "@/lib/builder-brief";
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
  type RepoStack,
  type ScanConflict,
  type ScanDep,
  type Trait,
} from "@/lib/builder-profile";
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
  const wasSignedIn = useRef<boolean | undefined>(undefined);

  // `isSignedIn` is part of the key on purpose: the same target is worth
  // refetching the moment the session changes, because the answer changed.
  const key = `${target}|${isSignedIn ? "in" : "out"}`;

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
          body: JSON.stringify({ target }),
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
  }, [key, target, isLoaded]);

  function submit(event: React.FormEvent) {
    event.preventDefault();
    const value = input.trim().replace(/^[/@]+/, "");
    if (!value) return;
    // In the URL, so a refresh, a shared link and the sign-up redirect all
    // come back to this report.
    router.replace(`/dashboard/report?target=${encodeURIComponent(value)}`, { scroll: false });
    setTarget(value);
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

      {state.kind === "idle" && (
        <EmptyState title="Scan a GitHub profile">
          Type a username, or a repo to put that repo first. Public repos only.
        </EmptyState>
      )}
      {state.kind === "running" && <Scanning target={state.target} />}
      {state.kind === "failed" && <InlineError>{state.message}</InlineError>}
      {state.kind === "done" && <Report report={state.report} target={target} />}
    </>
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

function Report({ report, target }: { report: BuilderReport; target: string }) {
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
            <p className="mt-2 max-w-[62ch] text-[13.5px] leading-relaxed text-ink-2">{type.line}</p>
          </div>
          <a
            href={report.url}
            target="_blank"
            rel="noopener"
            className="font-mono text-[12.5px] text-ink-3 transition-colors hover:text-ink"
          >
            @{report.login}
          </a>
        </div>
        <ReportActions report={report} target={target} back={back} />
      </Panel>

      <StatRow>
        <StatTile label="repos" value={report.stats.repos} hint="owned, not forks" />
        <StatTile label="active" value={report.stats.active90} hint="pushed in the last 90 days" />
        <StatTile label="stars" value={report.stats.stars} />
        <StatTile
          label="top language"
          value={languages[0]?.name ?? "—"}
          hint={languages.length > 1 ? `then ${languages.slice(1, 3).map((l) => l.name).join(", ")}` : undefined}
        />
      </StatRow>

      <Summary report={report} />

      <Traits traits={report.traits} archetype={report.archetype} back={back} />

      {report.locked && <Gate report={report} back={back} />}

      {first ? (
        <Panel padding="none">
          <StackHead stack={first} hiddenDeps={report.locked?.deps ?? 0} />
          <StackBody stack={first} />
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
                    <StackBody stack={stack} bare />
                  </div>
                </details>
              </li>
            ))}
          </ul>
        </Panel>
      )}

      {!report.locked && first && (
        <EmptyState
          title="This read root manifests only"
          action={
            <Link
              href={`/dashboard/repos?scan=${encodeURIComponent(first.repo)}`}
              className={buttonVariants({ variant: "outline", size: "sm" })}
            >
              Connect {first.repo}
            </Link>
          }
        >
          Connect a repo and lurq reads every manifest in it, then tells you when an upgrade would
          break something.
        </EmptyState>
      )}
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

/** The sign-up ask, stated in the visitor's own numbers. */
function Gate({ report, back }: { report: BuilderReport; back: string }) {
  const locked = report.locked!;
  const first = report.repos[0];
  const items = [
    "The score on all four traits, and the facts behind each",
    "Strengths, what to fix, and a stats card to share",
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
 * stats card. The card is signed-in only because it is the trait scores; the
 * brief is whatever this session was sent, so it needs no gate of its own.
 */
function ReportActions({ report, target, back }: { report: BuilderReport; target: string; back: string }) {
  return (
    <div className="mt-5 flex flex-wrap items-center gap-2 border-t border-edge pt-4">
      <CopyButton
        text={reportBrief(report)}
        label="Copy report for your agent"
        onCopy={() => posthog.capture("builder_report_copy", { scope: "report", login: report.login })}
      />
      {report.locked ? (
        <SignUpButton mode="modal" fallbackRedirectUrl={back} signInFallbackRedirectUrl={back}>
          <button type="button" className={cn(buttonVariants({ variant: "outline", size: "sm" }), "gap-1.5")}>
            <Lock aria-hidden className="size-3.5" />
            Export stats card
          </button>
        </SignUpButton>
      ) : (
        <a
          href={`/api/scan/card?target=${encodeURIComponent(target)}`}
          download={`lurq-${report.login}.png`}
          onClick={() => posthog.capture("builder_card_export", { login: report.login, archetype: report.archetype })}
          className={cn(buttonVariants({ variant: "outline", size: "sm" }), "gap-1.5")}
        >
          <Download aria-hidden className="size-3.5" />
          Export stats card
        </a>
      )}
      <p className="text-[11.5px] text-ink-3">
        The brief ranks your repos worst first, so an agent knows where to start.
      </p>
    </div>
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

function RepoCopy({ stack, hiddenDeps = 0 }: { stack: RepoStack; hiddenDeps?: number }) {
  return (
    <CopyInline
      text={repoBrief(stack, hiddenDeps)}
      label="copy for agent"
      onCopy={() => posthog.capture("builder_report_copy", { scope: "repo", repo: stack.repo })}
    />
  );
}

function StackHead({ stack, hiddenDeps }: { stack: RepoStack; hiddenDeps: number }) {
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
      <RepoCopy stack={stack} hiddenDeps={hiddenDeps} />
    </div>
  );
}

function Counts({ stack }: { stack: RepoStack }) {
  return (
    <span className="flex flex-wrap justify-end gap-1.5">
      <Chip>{plural(stack.depsTracked, "dep")}</Chip>
      {stack.majorDrift > 0 && <Chip tone="warn">{stack.majorDrift} major behind</Chip>}
      {stack.advisories > 0 && <Chip tone="bad">{plural(stack.advisories, "advisory", "advisories")}</Chip>}
      {stack.conflicts > 0 && <Chip tone="bad">{plural(stack.conflicts, "conflict")}</Chip>}
    </span>
  );
}

function StackBody({ stack, bare = false }: { stack: RepoStack; bare?: boolean }) {
  if (stack.depsTracked === 0) {
    return (
      <p className="px-[var(--panel-px)] py-4 text-[13px] leading-relaxed text-ink-2">
        Nothing in this manifest is in the index yet. It has been queued, so the same scan in a few
        minutes will have something to say.
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
          <DepRow key={dep.name} dep={dep} />
        ))}
      </ul>
      {stack.conflictDetail.length > 0 && <Conflicts conflicts={stack.conflictDetail} />}
    </>
  );
}

/** The worst thing true about one dependency, in the fewest words. */
function verdict(dep: ScanDep): { text: string; tone: string } {
  if (dep.advisories > 0) {
    return { text: plural(dep.advisories, "advisory", "advisories"), tone: "text-bad" };
  }
  if (dep.deprecated) return { text: "deprecated", tone: "text-bad" };
  if (dep.majorsBehind > 0) return { text: `${dep.majorsBehind} major behind`, tone: "text-warn" };
  return { text: "current", tone: "text-ink-3" };
}

function DepRow({ dep }: { dep: ScanDep }) {
  const v = verdict(dep);
  return (
    // Wraps rather than overflowing: a canary range plus "→ latest" plus the
    // verdict is wider than a phone, and shrink-0 on both pushed the page sideways.
    <li className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 px-[var(--panel-px)] py-2">
      <span className="min-w-0 max-w-full truncate font-mono text-[12.5px] text-ink">{dep.name}</span>
      <span className="min-w-0 break-all font-mono text-[11.5px] text-ink-3">
        {dep.resolved ?? dep.range}
        {dep.latest && dep.latest !== dep.resolved ? ` → ${dep.latest}` : ""}
      </span>
      <span className={cn("ml-auto shrink-0 font-mono text-[11px]", v.tone)}>{v.text}</span>
    </li>
  );
}

function Conflicts({ conflicts }: { conflicts: ScanConflict[] }) {
  return (
    <ul className="divide-y divide-edge border-t border-edge">
      {conflicts.map((c, i) => (
        <li key={`${c.source}-${i}`} className="px-[var(--panel-px)] py-3">
          <p className="font-mono text-[12px] text-ink">{c.packages.join(" · ")}</p>
          <p className="mt-1 text-[12.5px] leading-normal text-ink-2">{c.detail}</p>
          <p className={cn(microLabel, "mt-1")}>{c.source}</p>
        </li>
      ))}
    </ul>
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
