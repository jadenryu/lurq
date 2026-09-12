"use client";

import { useRef, useState } from "react";
import Link from "next/link";

/**
 * Type a repo, see your own dependencies, before anything asks who you are.
 *
 * Every other proof on this page is about somebody else's stack: a recorded
 * session, an index-wide drift board, ten tool schemas. All of it is evidence
 * and none of it is *theirs*, and the gap between "I believe this works" and "I
 * want this" is exactly that. This box closes it in one field.
 *
 * IT SITS IN THE HERO, under the install command, and that placement is the
 * whole point rather than a layout preference. The command asks for a terminal
 * and a decision; this asks for a repo name and gives something back. A visitor
 * who is not ready to install now has something to do other than leave.
 *
 * NOTHING HERE IS GATED. The counts are real, the dependency rows are real, and
 * the sign-in link under them is a link rather than a wall. A teaser that
 * blurred its own numbers would be the same page as before with an extra step:
 * the reason to sign up is the rest of the repo, the other manifests, the
 * conflicts written out, and the watch that tells you when it changes.
 *
 * See src/github/publicScan.ts for what the scan reads (the root package.json,
 * over unauthenticated HTTP) and app/api/scan for the hop.
 *
 * The result panel arrives on `data-reveal="open"`, the same variant the
 * dashboard's expanding rows use, because this is the same event: content that
 * exists because somebody pressed something. It used to appear between two
 * frames, which after a second of waiting read as a jump rather than an answer.
 */

interface Dep {
  name: string;
  range: string;
  resolved: string | null;
  latest: string | null;
  majorsBehind: number;
  deprecated: boolean;
  advisories: number;
}

interface Scan {
  repo: string;
  url: string;
  depsDeclared: number;
  depsTracked: number;
  majorDrift: number;
  anyDrift: number;
  deprecated: number;
  advisories: number;
  conflicts: number;
  deps: Dep[];
  partial: boolean;
}

type State =
  | { kind: "idle" }
  | { kind: "running" }
  | { kind: "failed"; message: string }
  | { kind: "done"; scan: Scan };

/** One number and what it counts. */
function Tile({ n, label, hot }: { n: number; label: string; hot?: boolean }) {
  return (
    <div className="min-w-0">
      <p
        className="font-sans text-[26px] font-medium leading-none tracking-[-0.02em]"
        style={{ color: hot && n > 0 ? "var(--rail)" : "var(--ink)" }}
      >
        {n}
      </p>
      <p className="mt-1.5 text-[11.5px] leading-[1.35] text-ink-3">{label}</p>
    </div>
  );
}

/** The worst thing true about one dependency, in the fewest words. */
function verdict(dep: Dep): { text: string; tone: string } {
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

function Result({ scan }: { scan: Scan }) {
  const untracked = scan.depsDeclared - scan.depsTracked;

  return (
    <div
      data-reveal="open"
      className="mt-6 overflow-hidden rounded-xl border border-edge border-t-edge-lit bg-surface text-left"
    >
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-edge bg-surface-2 px-5 py-3">
        <a
          href={scan.url}
          target="_blank"
          rel="noopener"
          className="font-mono text-[12.5px] text-ink transition-colors hover:text-mark focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-mark"
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
          Nothing in that manifest is in the index yet. It has been queued, so the same
          scan in a few minutes will have something to say.
        </p>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-y-5 px-5 py-5 min-[560px]:grid-cols-4">
            <Tile n={scan.depsTracked} label="dependencies read" />
            <Tile n={scan.majorDrift} label="a major behind" hot />
            <Tile n={scan.advisories} label="advisories" hot />
            <Tile n={scan.conflicts} label="conflicts at latest" hot />
          </div>

          <ul className="border-t border-edge">
            {scan.deps.map((dep) => {
              const v = verdict(dep);
              return (
                <li
                  key={dep.name}
                  className="flex items-baseline gap-3 border-b border-edge px-5 py-2.5 last:border-b-0"
                >
                  <span className="truncate font-mono text-[12.5px] text-ink">{dep.name}</span>
                  <span className="shrink-0 font-mono text-[11.5px] text-ink-3">
                    {dep.resolved ?? dep.range}
                    {dep.latest && dep.latest !== dep.resolved ? ` → ${dep.latest}` : ""}
                  </span>
                  <span
                    className="ml-auto shrink-0 font-mono text-[11px]"
                    style={{ color: v.tone }}
                  >
                    {v.text}
                  </span>
                </li>
              );
            })}
          </ul>
        </>
      )}

      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-edge bg-surface-2 px-5 py-3.5">
        <p className="text-[12.5px] leading-[1.5] text-ink-2">
          Every manifest, the conflicts written out, and a note when one changes.
        </p>
        <Link
          href={`/dashboard/repos?scan=${encodeURIComponent(scan.repo)}`}
          className="ml-auto shrink-0 text-[12.5px] font-medium text-mark underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-mark"
        >
          Open the full report
        </Link>
      </div>
    </div>
  );
}

export function RepoScan() {
  const [state, setState] = useState<State>({ kind: "idle" });
  const [target, setTarget] = useState("");
  /** The scan in flight, so a fast second submit cannot land after a slow first. */
  const run = useRef(0);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    const value = target.trim();
    if (!value || state.kind === "running") return;

    const id = ++run.current;
    setState({ kind: "running" });
    try {
      const res = await fetch("/api/scan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ target: value }),
      });
      const data = (await res.json()) as Scan & { error?: string };
      if (id !== run.current) return;
      if (!res.ok) {
        setState({ kind: "failed", message: data.error ?? "Could not read that." });
        return;
      }
      setState({ kind: "done", scan: data });
    } catch {
      if (id === run.current) {
        setState({ kind: "failed", message: "Could not reach the index. Try again." });
      }
    }
  }

  const running = state.kind === "running";

  return (
    <div className="mx-auto mt-9 w-full max-w-[620px]">
      <form onSubmit={submit} className="room-scan-field">
        <label htmlFor="repo-scan" className="sr-only">
          Your GitHub repository or username
        </label>
        {/* Decoration: the placeholder and the label both already say what goes
            in here. */}
        <span aria-hidden className="room-scan-glyph">
          /
        </span>
        <input
          id="repo-scan"
          value={target}
          onChange={(e) => setTarget(e.target.value)}
          placeholder="your-name/your-repo, or just your-name"
          spellCheck={false}
          autoComplete="off"
          autoCapitalize="off"
          className="room-scan-input"
        />
        <button type="submit" disabled={running || !target.trim()} className="room-scan-go">
          {running ? "Reading…" : "Scan"}
        </button>
      </form>

      <p aria-live="polite" className="mt-2.5 text-[12.5px] leading-[1.5] text-ink-3">
        {state.kind === "failed"
          ? state.message
          : running
            ? "Reading the manifest, then the index."
            : "Public repos only. No sign-in, nothing installed."}
      </p>

      {state.kind === "done" && <Result scan={state.scan} />}
    </div>
  );
}
