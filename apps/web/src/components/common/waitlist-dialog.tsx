"use client";

import { useEffect, useRef, useState } from "react";
import Script from "next/script";
import { Dialog } from "@base-ui/react/dialog";
import { ArrowRight, Check, Mail, XIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

// Cloudflare's "always passes" test key renders the widget locally; set the real
// NEXT_PUBLIC_TURNSTILE_SITE_KEY (and TURNSTILE_SECRET_KEY on the server) in prod.
const TURNSTILE_SITE_KEY =
  process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY ?? "1x00000000000000000000AA";

type Status = "idle" | "submitting" | "success" | "error";

export function WaitlistDialog({
  triggerLabel = "Join the waitlist",
  triggerClassName,
  triggerSize = "lg",
}: {
  triggerLabel?: string;
  triggerClassName?: string;
  triggerSize?: "default" | "sm" | "lg";
}) {
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<Status>("idle");
  const [errorMsg, setErrorMsg] = useState("");
  const [token, setToken] = useState("");

  // Turnstile renders its widget into this container. We render *explicitly*
  // (not via the auto-scanned `.cf-turnstile` class): the widget lives inside a
  // dialog that mounts after the Turnstile script has already loaded, and
  // implicit rendering only scans the DOM once at load, so a late-mounted
  // widget would never appear, leaving users unable to pass verification.
  const widgetRef = useRef<HTMLDivElement>(null);
  const widgetIdRef = useRef<string | null>(null);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    let retry: ReturnType<typeof setTimeout>;

    function renderWidget() {
      if (cancelled) return;
      const el = widgetRef.current;
      if (!window.turnstile || !el) {
        retry = setTimeout(renderWidget, 150); // script not ready yet
        return;
      }
      if (widgetIdRef.current) return; // already rendered
      setToken("");
      widgetIdRef.current = window.turnstile.render(el, {
        sitekey: TURNSTILE_SITE_KEY,
        theme: "dark",
        callback: (t) => setToken(t),
        "error-callback": () => setToken(""),
        "expired-callback": () => setToken(""),
      });
    }

    renderWidget();
    return () => {
      cancelled = true;
      clearTimeout(retry);
      if (widgetIdRef.current && window.turnstile) {
        try {
          window.turnstile.remove(widgetIdRef.current);
        } catch {
          // widget DOM may already be gone, ignore
        }
      }
      widgetIdRef.current = null;
    };
  }, [open]);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const data = new FormData(form);
    const company = String(data.get("company") ?? "");

    if (!token) {
      setStatus("error");
      setErrorMsg("Please complete the verification and try again.");
      return;
    }

    setStatus("submitting");
    setErrorMsg("");
    try {
      const res = await fetch("/api/waitlist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, company, token }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? "Something went wrong.");
      }
      setStatus("success");
      setEmail("");
    } catch (err) {
      setStatus("error");
      setErrorMsg((err as Error).message);
      // Turnstile tokens are single-use; get a fresh one for the retry.
      if (widgetIdRef.current) window.turnstile?.reset(widgetIdRef.current);
      setToken("");
    }
  }

  return (
    <Dialog.Root
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        // Reset back to the form when reopening after a success.
        if (!next) setTimeout(() => setStatus("idle"), 200);
      }}
    >
      <Dialog.Trigger
        render={
          <Button size={triggerSize} className={cn("px-7", triggerClassName)} />
        }
      >
        {triggerLabel}
      </Dialog.Trigger>

      <Dialog.Portal>
        <Dialog.Backdrop className="fixed inset-0 z-50 bg-black/60 transition-opacity duration-200 data-ending-style:opacity-0 data-starting-style:opacity-0 supports-backdrop-filter:backdrop-blur-md" />
        <Dialog.Popup className="fixed left-1/2 top-1/2 z-50 w-[calc(100vw-2rem)] max-w-[25rem] -translate-x-1/2 -translate-y-1/2 overflow-hidden rounded-2xl border border-white/10 bg-card/90 p-7 shadow-2xl shadow-black/60 ring-1 ring-white/[0.04] backdrop-blur-xl transition duration-200 data-ending-style:scale-[0.98] data-ending-style:opacity-0 data-starting-style:scale-[0.98] data-starting-style:opacity-0">
          {/* hairline top-light + soft glow: the Linear "lit panel" cue */}
          <div
            aria-hidden
            className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-white/25 to-transparent"
          />
          <div
            aria-hidden
            className="pointer-events-none absolute -top-20 left-1/2 h-40 w-40 -translate-x-1/2 rounded-full bg-white/[0.07] blur-3xl"
          />

          <Dialog.Close
            render={
              <Button
                variant="ghost"
                size="icon-sm"
                className="absolute right-3 top-3 text-muted-foreground/60 hover:text-foreground"
              />
            }
          >
            <XIcon />
            <span className="sr-only">Close</span>
          </Dialog.Close>

          {status === "success" ? (
            <div className="relative flex flex-col items-center py-5 text-center">
              <div className="flex size-12 items-center justify-center rounded-full border border-white/10 bg-white/[0.04] shadow-inner shadow-white/[0.03]">
                <Check className="size-5 text-foreground" />
              </div>
              <Dialog.Title className="mt-4 font-heading text-lg font-semibold tracking-tight">
                You&apos;re on the list
              </Dialog.Title>
              <Dialog.Description className="mt-1.5 max-w-[17rem] text-sm leading-relaxed text-muted-foreground">
                We&apos;ll email you the moment lurq is ready to install
              </Dialog.Description>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="mt-5 text-sm text-muted-foreground/70 underline-offset-4 transition-colors hover:text-foreground hover:underline"
              >
                Close
              </button>
            </div>
          ) : (
            <div className="relative">
              <Script
                src="https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit"
                async
                defer
              />
              <div className="font-mono text-[0.7rem] uppercase tracking-[0.2em] text-muted-foreground/60">
                Pre-alpha access
              </div>
              <Dialog.Title className="mt-2.5 font-heading text-xl font-semibold tracking-tight">
                Join the waitlist
              </Dialog.Title>
              <Dialog.Description className="mt-2 text-sm leading-relaxed text-muted-foreground">
                Drop your email and you&apos;ll be first in line when the install
                command goes live.
              </Dialog.Description>

              <form onSubmit={handleSubmit} className="mt-6 flex flex-col gap-3">
                <label htmlFor="waitlist-email" className="sr-only">
                  Email
                </label>
                <div className="group relative">
                  <Mail
                    aria-hidden
                    className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground/45 transition-colors group-focus-within:text-foreground/70"
                  />
                  <input
                    id="waitlist-email"
                    type="email"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="you@company.com"
                    autoComplete="email"
                    className="h-11 w-full rounded-lg border border-white/10 bg-white/[0.02] pl-10 pr-3.5 font-mono text-sm text-foreground outline-none transition-colors placeholder:font-sans placeholder:text-muted-foreground/40 hover:border-white/15 focus:border-white/30 focus:bg-white/[0.04]"
                  />
                </div>

                {/* Honeypot: hidden from users; bots tend to fill it. */}
                <div aria-hidden className="hidden">
                  <label htmlFor="waitlist-company">Company</label>
                  <input
                    id="waitlist-company"
                    name="company"
                    type="text"
                    tabIndex={-1}
                    autoComplete="off"
                  />
                </div>

                {/* Cloudflare Turnstile, rendered explicitly into this node
                    (see the effect above). min-height avoids layout shift while
                    the widget iframe loads. */}
                <div ref={widgetRef} className="min-h-[65px] [color-scheme:dark]" />

                <button
                  type="submit"
                  disabled={status === "submitting"}
                  className="group/btn inline-flex h-11 w-full items-center justify-center gap-1.5 rounded-lg bg-primary text-sm font-medium text-primary-foreground transition-all hover:bg-primary/90 active:translate-y-px disabled:pointer-events-none disabled:opacity-60"
                >
                  {status === "submitting" ? (
                    "Joining…"
                  ) : (
                    <>
                      Join the waitlist
                      <ArrowRight className="size-4 transition-transform group-hover/btn:translate-x-0.5" />
                    </>
                  )}
                </button>

                {status === "error" && (
                  <p className="text-center text-xs text-destructive">
                    {errorMsg}
                  </p>
                )}
              </form>
            </div>
          )}
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
