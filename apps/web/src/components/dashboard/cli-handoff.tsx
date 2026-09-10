"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Panel, eyebrow } from "@/components/dashboard/panel";

/**
 * Mint a key and hand it to the waiting CLI on localhost.
 *
 * ONE CLICK RATHER THAN ON LOAD, and the click is not politeness. This page
 * mints a live credential and posts it to a port named in its own URL: doing
 * that the instant the page renders would mean a link sent to a signed-in user
 * mints them a key and delivers it wherever the link says. The attack needs
 * code already running on the victim's machine to be worth anything, but the
 * fix costs one button, so there is no version of this argument where drive-by
 * issuance wins.
 *
 * The POST goes to http://127.0.0.1 from an https page. That is allowed:
 * localhost is a trustworthy origin, so it is not blocked as mixed content. The
 * CLI answers the preflight, including the private-network header Chrome asks
 * for. When it does not answer at all (the terminal was closed, a firewall ate
 * it) the failure says exactly that and offers the paste path instead, which
 * still works and always did.
 */

type State =
  | { kind: "ready" }
  | { kind: "working" }
  | { kind: "done" }
  | { kind: "failed"; message: string };

function label(): string {
  return `cli · ${new Date().toLocaleDateString("en-US", { month: "short", day: "numeric" })}`;
}

export function CliHandoff({ port, nonce }: { port: number | null; nonce: string | null }) {
  const [state, setState] = useState<State>({ kind: "ready" });
  const running = useRef(false);

  if (port === null || nonce === null) {
    return (
      <Panel padding="tight">
        <p className={eyebrow}>nothing to connect</p>
        <p className="mt-2 text-sm text-muted-foreground">
          This page is opened by <code className="font-mono text-xs">npx lurqrun</code> and needs
          the details that command puts in the link. Run it in your terminal, or{" "}
          <Link href="/dashboard/keys" className="text-signal underline-offset-4 hover:underline">
            create a key by hand
          </Link>
          .
        </p>
      </Panel>
    );
  }

  async function connect() {
    if (running.current) return;
    running.current = true;
    setState({ kind: "working" });

    try {
      const minted = await fetch("/api/keys", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ label: label() }),
      });
      const data = (await minted.json()) as { key?: string; error?: string };
      if (!minted.ok || !data.key) {
        setState({ kind: "failed", message: data.error ?? "Could not create a key." });
        return;
      }

      const handed = await fetch(`http://127.0.0.1:${port}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ nonce, key: data.key, label: label() }),
      });
      if (!handed.ok) throw new Error("rejected");

      setState({ kind: "done" });
    } catch {
      setState({
        kind: "failed",
        message:
          "The terminal that opened this page isn't listening any more. Re-run npx lurqrun, or paste a key from the keys page.",
      });
    } finally {
      running.current = false;
    }
  }

  if (state.kind === "done") {
    return (
      <Panel padding="tight">
        <p className={eyebrow}>connected</p>
        <p className="mt-2 text-sm text-muted-foreground">
          Your key is in that terminal and setup is carrying on there. You can close this tab.
        </p>
      </Panel>
    );
  }

  return (
    <Panel padding="tight">
      <p className={eyebrow}>waiting on you</p>
      <p className="mt-2 max-w-xl text-sm text-muted-foreground">
        A new key will be created for this machine and sent to the terminal listening on port{" "}
        <span className="font-mono">{port}</span>. It never leaves your computer on the way there,
        and you can revoke it any time from the keys page.
      </p>
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <Button onClick={connect} disabled={state.kind === "working"}>
          {state.kind === "working" ? "Connecting…" : "Connect this terminal"}
        </Button>
        <Link
          href="/dashboard/keys"
          className="text-sm text-muted-foreground underline-offset-4 hover:underline"
        >
          Do it by hand instead
        </Link>
      </div>
      {state.kind === "failed" && (
        <p className="mt-3 max-w-xl text-sm text-destructive">{state.message}</p>
      )}
    </Panel>
  );
}
